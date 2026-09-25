import axios from 'axios';
import { db, searchPaperChunks, savePaperChunks, isPaperIndexed } from './db.js';
import { fetchAndChunkPaper } from './paperFetcher.js';

export interface QasperEvalResult {
  benchmarkName: string;
  datasetSplit: string;
  totalQuestionsTested: number;
  totalPapersTested: number;
  recallAt1: number;
  recallAt3: number;
  recallAt5: number;
  mrr: number;
  avgRetrievalLatencyMs: number;
  sampleResults: {
    paperTitle: string;
    question: string;
    hitAt3: boolean;
    hitAt5: boolean;
    topChunkSection: string;
    goldEvidencePreview: string;
  }[];
}

/**
 * Normalizes text to compare overlap between retrieved chunk and gold evidence
 */
function textOverlapScore(chunk: string, goldEvidence: string): number {
  const cleanChunk = chunk.toLowerCase().replace(/[^\w\s]/g, ' ');
  const cleanGold = goldEvidence.toLowerCase().replace(/[^\w\s]/g, ' ');

  const goldTokens = new Set(
    cleanGold.split(/\s+/).filter(t => t.length > 3 && !['this', 'that', 'with', 'from', 'table', 'figure', 'paper', 'which', 'what'].includes(t))
  );

  if (goldTokens.size === 0) return 0;

  let matched = 0;
  for (const token of goldTokens) {
    if (cleanChunk.includes(token)) {
      matched++;
    }
  }

  return matched / goldTokens.size;
}

export async function runQasperEvaluation(maxPapers: number = 3): Promise<QasperEvalResult> {
  const url = `https://datasets-server.huggingface.co/rows?dataset=allenai%2Fqasper&config=qasper&split=validation&offset=0&limit=${maxPapers}`;
  
  const response = await axios.get(url, { timeout: 10000 });
  const rows = response.data?.rows || [];

  let totalQuestions = 0;
  let hits1 = 0;
  let hits3 = 0;
  let hits5 = 0;
  let reciprocalRankSum = 0;
  let totalLatency = 0;
  const sampleResults: any[] = [];

  for (const r of rows) {
    const row = r.row;
    const paperId = row.id;
    const title = row.title;
    const questions = row.qas?.question || [];
    const answersList = row.qas?.answers || [];

    // Ingest paper into DB (using QASPER full_text directly for instantaneous indexing)
    if (!isPaperIndexed(paperId)) {
      const sections = row.full_text?.section_name || [];
      const paragraphs = row.full_text?.paragraphs || [];
      const manualChunks: any[] = [];
      let cIdx = 0;
      for (let i = 0; i < sections.length; i++) {
        const secName = sections[i] || 'Section';
        const pList = paragraphs[i] || [];
        for (const p of pList) {
          if (p && p.trim().length > 30) {
            manualChunks.push({
              section: secName,
              chunkIndex: cIdx++,
              content: `[Section: ${secName}]\n${p.trim()}`,
            });
          }
        }
      }

      if (manualChunks.length > 0) {
        savePaperChunks(paperId, title, manualChunks, 'qasper_dataset');
      } else {
        try {
          const ingested = await fetchAndChunkPaper(paperId, title, row.abstract || '');
          savePaperChunks(paperId, title, ingested.chunks, ingested.source);
        } catch {}
      }
    }

    for (let qIdx = 0; qIdx < questions.length; qIdx++) {
      const q = questions[qIdx];
      const answerObj = answersList[qIdx]?.answer?.[0];
      const goldEvidences: string[] = answerObj?.evidence || [];
      if (goldEvidences.length === 0 || !goldEvidences[0]) continue;

      totalQuestions++;
      const start = performance.now();
      const results = searchPaperChunks(q, [paperId], 5);
      const elapsed = performance.now() - start;
      totalLatency += elapsed;

      let foundRank = -1;
      for (let rank = 0; rank < results.length; rank++) {
        const chunkContent = results[rank].content;
        for (const gold of goldEvidences) {
          if (textOverlapScore(chunkContent, gold) >= 0.35 || chunkContent.includes(gold.slice(0, 40))) {
            foundRank = rank;
            break;
          }
        }
        if (foundRank !== -1) break;
      }

      const hitAt1 = foundRank === 0;
      const hitAt3 = foundRank !== -1 && foundRank < 3;
      const hitAt5 = foundRank !== -1 && foundRank < 5;

      if (hitAt1) hits1++;
      if (hitAt3) hits3++;
      if (hitAt5) hits5++;
      if (foundRank !== -1) {
        reciprocalRankSum += 1 / (foundRank + 1);
      }

      if (sampleResults.length < 5) {
        sampleResults.push({
          paperTitle: title,
          question: q,
          hitAt3,
          hitAt5,
          topChunkSection: results[0]?.section || 'None',
          goldEvidencePreview: goldEvidences[0].slice(0, 140) + '...'
        });
      }
    }
  }

  const denominator = Math.max(totalQuestions, 1);
  return {
    benchmarkName: 'AllenAI QASPER (Question Answering on Scientific Papers)',
    datasetSplit: 'validation',
    totalQuestionsTested: totalQuestions,
    totalPapersTested: rows.length,
    recallAt1: Number((hits1 / denominator).toFixed(3)),
    recallAt3: Number((hits3 / denominator).toFixed(3)),
    recallAt5: Number((hits5 / denominator).toFixed(3)),
    mrr: Number((reciprocalRankSum / denominator).toFixed(3)),
    avgRetrievalLatencyMs: Number((totalLatency / denominator).toFixed(2)),
    sampleResults
  };
}
