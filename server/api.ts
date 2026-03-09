import { Router } from 'express';
import { clearPapers, getPapers, getPapersByIds } from './db.js';
import { fetchFromArxiv } from './arxiv.js';
import fs from 'fs';
import path from 'path';

const router = Router();

const CATEGORIES_TREE = {
  cs: ['AI', 'AR', 'CC', 'CE', 'CG', 'CL', 'CR', 'CV', 'CY', 'DB', 'DC', 'DL', 'DM', 'DS', 'ET', 'FL', 'GL', 'GR', 'GT', 'HC', 'IR', 'IT', 'LG', 'LO', 'MA', 'MM', 'MS', 'NA', 'NE', 'NI', 'OS', 'PF', 'PL', 'RO', 'SC', 'SD', 'SE', 'SI', 'SY'],
  math: ['AG', 'AP', 'AT', 'CA', 'CO', 'CT', 'CV', 'DG', 'DS', 'FA', 'GM', 'GN', 'GR', 'GT', 'HO', 'IT', 'KT', 'LO', 'MG', 'MP', 'NA', 'NT', 'OA', 'OC', 'PR', 'QA', 'RA', 'RT', 'SG', 'SP', 'ST'],
  stat: ['AP', 'CO', 'ME', 'ML', 'OT', 'TH'],
  'q-bio': ['BM', 'CB', 'GN', 'MN', 'NC', 'OT', 'PE', 'QM', 'SC', 'TO'],
  'q-fin': ['CP', 'EC', 'GN', 'MF', 'PM', 'PR', 'RM', 'ST', 'TR'],
  eess: ['AS', 'IV', 'SP', 'SY'],
  econ: ['EM', 'GN', 'TH'],
  physics: ['acc-ph', 'ao-ph', 'app-ph', 'atm-clus', 'atom-ph', 'bio-ph', 'chem-ph', 'class-ph', 'comp-ph', 'data-an', 'ed-ph', 'flu-dyn', 'gen-ph', 'geo-ph', 'hist-ph', 'ins-det', 'med-ph', 'optics', 'pop-ph', 'soc-ph', 'space-ph'],
  'astro-ph': ['CO', 'EP', 'GA', 'HE', 'IM', 'SR'],
  'cond-mat': ['dis-nn', 'mes-hall', 'mtrl-sci', 'other', 'quant-gas', 'soft', 'stat-mech', 'str-el', 'supr-con'],
  nlin: ['AO', 'CD', 'CG', 'PS', 'SI'],
  'gr-qc': ['gr-qc'],
  'hep-ex': ['hep-ex'],
  'hep-lat': ['hep-lat'],
  'hep-ph': ['hep-ph'],
  'hep-th': ['hep-th'],
  'math-ph': ['math-ph'],
  'nucl-ex': ['nucl-ex'],
  'nucl-th': ['nucl-th'],
  'quant-ph': ['quant-ph']
};

router.get('/arxiv/categories', (req, res) => {
  res.json({ tree: CATEGORIES_TREE });
});

router.get('/arxiv/matrix-html', (req, res) => {
  const { categories, date, papers_per_tag } = req.query;
  const cats = categories ? (categories as string).split(',') : undefined;
  const limit = papers_per_tag ? parseInt(papers_per_tag as string) * (cats?.length || 1) : undefined;
  
  const papers = getPapers(cats, date as string, limit);
  res.json({ papers });
});

router.post('/arxiv/clear', (req, res) => {
  clearPapers();
  res.json({ ok: true });
});

router.post('/arxiv/fetch', async (req, res) => {
  const { categories, papers_per_tag, date } = req.body;
  let totalFound = 0;
  let totalAdded = 0;

  try {
    for (const cat of categories) {
      const { found, added } = await fetchFromArxiv(cat, papers_per_tag || 10, date);
      totalFound += found;
      totalAdded += added;
    }
    res.json({ ok: true, total_found: totalFound, new_added: totalAdded });
  } catch (error) {
    res.status(500).json({ ok: false, error: String(error) });
  }
});

router.post('/arxiv/papers', (req, res) => {
  const { paper_ids, date } = req.body;
  try {
    let papers = [];
    if (paper_ids && paper_ids.length > 0) {
      papers = getPapersByIds(paper_ids);
    } else {
      papers = getPapers(undefined, date);
    }
    res.json({ ok: true, papers });
  } catch (error) {
    res.status(500).json({ ok: false, error: String(error) });
  }
});

router.post('/arxiv/podcast/save', (req, res) => {
  const { script, audio_base64 } = req.body;
  
  try {
    // Save transcript
    const transcriptHtml = script.split('\n').map((line: string) => {
      if (line.startsWith('ALEX:')) return `<p><strong>Alex:</strong> ${line.substring(5)}</p>`;
      if (line.startsWith('SAM:')) return `<p><strong>Sam:</strong> ${line.substring(4)}</p>`;
      return `<p>${line}</p>`;
    }).join('');
    
    const intelStackDir = path.join(process.cwd(), 'intel-stack');
    if (!fs.existsSync(intelStackDir)) fs.mkdirSync(intelStackDir);
    fs.writeFileSync(path.join(intelStackDir, 'arxiv_synopsis.html'), transcriptHtml);

    // Generate Audio
    const audioDir = path.join(process.cwd(), 'intel-stack', 'audio');
    if (!fs.existsSync(audioDir)) fs.mkdirSync(audioDir, { recursive: true });
    
    const filename = `briefing_${Date.now()}.wav`;
    const audioPath = path.join(audioDir, filename);
    
    const audioBuffer = Buffer.from(audio_base64, 'base64');
    const wavBuffer = createWavHeader(audioBuffer, 24000, 1, 16);
    fs.writeFileSync(audioPath, wavBuffer);

    res.json({ ok: true, result: { script_length: script.length, audio_file: `/audio/${filename}` } });
  } catch (error) {
    console.error(error);
    res.status(500).json({ ok: false, error: String(error) });
  }
});

function createWavHeader(pcmData: Buffer, sampleRate: number, numChannels: number, bitsPerSample: number) {
  const byteRate = sampleRate * numChannels * (bitsPerSample / 8);
  const blockAlign = numChannels * (bitsPerSample / 8);
  const dataSize = pcmData.length;
  const buffer = Buffer.alloc(44 + dataSize);

  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write('WAVE', 8);
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16); // Subchunk1Size
  buffer.writeUInt16LE(1, 20); // AudioFormat (PCM)
  buffer.writeUInt16LE(numChannels, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(byteRate, 28);
  buffer.writeUInt16LE(blockAlign, 32);
  buffer.writeUInt16LE(bitsPerSample, 34);
  buffer.write('data', 36);
  buffer.writeUInt32LE(dataSize, 40);
  
  pcmData.copy(buffer, 44);
  return buffer;
}

router.get('/arxiv/synopsis-html', (req, res) => {
  const synopsisPath = path.join(process.cwd(), 'intel-stack', 'arxiv_synopsis.html');
  if (fs.existsSync(synopsisPath)) {
    res.send(fs.readFileSync(synopsisPath, 'utf-8'));
  } else {
    res.send('<p>No synopsis available.</p>');
  }
});

router.get('/archive', (req, res) => {
  const audioDir = path.join(process.cwd(), 'intel-stack', 'audio');
  if (fs.existsSync(audioDir)) {
    const files = fs.readdirSync(audioDir).filter(f => f.endsWith('.wav') || f.endsWith('.mp3'));
    res.json(files);
  } else {
    res.json([]);
  }
});

export default router;
