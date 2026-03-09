import fs from 'fs';

let content = fs.readFileSync('src/App.tsx', 'utf-8');

const replacements = [
  ['divide-slate-800/50', 'divide-[#e5e3db]'],
  ['hover:bg-red-900/50', 'hover:bg-red-50'],
  ['hover:text-red-400', 'hover:text-red-600'],
  ['hover:border-red-800', 'hover:border-red-300'],
  ['bg-sky-600 text-white', 'bg-[#3a3a38] text-white'],
  ['bg-slate-800 text-slate-200', 'bg-[#f0eee6] text-[#2c2c2a]'],
  ['bg-slate-800 text-slate-400', 'bg-[#f0eee6] text-[#5c5c5a]'],
  ['text-sky-500', 'text-[#3a3a38]'],
  ['bg-slate-800', 'bg-[#f0eee6]'],
  ['text-slate-400', 'text-[#5c5c5a]'],
  ['hover:bg-white/30', 'hover:bg-[#f5f4ef]'],
  ['text-sky-300', 'text-[#5a5a58]'],
  ['text-sky-400', 'text-[#3a3a38]'],
  ['bg-slate-900', 'bg-white'],
  ['bg-slate-950', 'bg-[#fcfcfc]'],
  ['border-slate-800', 'border-[#e5e3db]'],
  ['border-slate-700', 'border-[#d5d3cb]'],
];

for (const [from, to] of replacements) {
  content = content.split(from).join(to);
}

fs.writeFileSync('src/App.tsx', content);
console.log('Done final replacements');
