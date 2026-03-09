import fs from 'fs';

let content = fs.readFileSync('src/App.tsx', 'utf-8');

const replacements = [
  ['bg-slate-950', 'bg-[#fcfcfc]'],
  ['bg-slate-900', 'bg-white'],
  ['bg-slate-800', 'bg-gray-100'],
  ['bg-slate-700', 'bg-gray-200'],
  ['text-slate-200', 'text-gray-900'],
  ['text-slate-300', 'text-gray-800'],
  ['text-slate-400', 'text-gray-600'],
  ['text-slate-500', 'text-gray-500'],
  ['border-slate-800', 'border-gray-200'],
  ['border-slate-700', 'border-gray-300'],
  ['text-sky-400', 'text-indigo-900'],
  ['text-sky-300', 'text-indigo-700'],
  ['text-sky-500', 'text-indigo-600'],
  ['bg-sky-600', 'bg-indigo-900'],
  ['hover:bg-sky-500', 'hover:bg-indigo-800'],
  ['hover:bg-slate-800', 'hover:bg-gray-200'],
  ['hover:bg-slate-900', 'hover:bg-gray-100'],
  ['hover:text-white', 'hover:text-black'],
  ['text-amber-500', 'text-amber-700'],
  ['bg-slate-950/50', 'bg-gray-50'],
  ['bg-slate-900/50', 'bg-white/80'],
  ['bg-slate-900/80', 'bg-white/90'],
  ['bg-slate-900/30', 'bg-gray-50'],
  ['bg-slate-800/50', 'bg-gray-100/80'],
  ['border-slate-800/50', 'border-gray-200/50'],
  ['focus:ring-sky-500', 'focus:ring-indigo-600'],
  ['focus:ring-offset-slate-900', 'focus:ring-offset-white'],
  ['focus:border-sky-500', 'focus:border-indigo-600'],
  ['text-white', 'text-white'], // keep text-white where it is inside colored buttons
  ['bg-black/60', 'bg-gray-900/40'],
  ['text-sky-600', 'text-indigo-600'],
  ['hover:text-sky-400', 'hover:text-indigo-800'],
];

for (const [from, to] of replacements) {
  content = content.split(from).join(to);
}

// Add font-serif to headers
content = content.replace(/<h1 className="(.*?)"/g, '<h1 className="$1 font-serif"');
content = content.replace(/<h2 className="(.*?)"/g, '<h2 className="$1 font-serif"');
content = content.replace(/<h3 className="(.*?)"/g, '<h3 className="$1 font-serif"');

fs.writeFileSync('src/App.tsx', content);
console.log('Done replacing classes');
