import fs from 'fs';

let content = fs.readFileSync('src/App.tsx', 'utf-8');

const replacements = [
  ['bg-sky-900/50', 'bg-indigo-50'],
  ['border-sky-800/50', 'border-indigo-200'],
  ['text-slate-600', 'text-gray-400'],
  ['text-sky-500', 'text-indigo-600'],
  ['bg-sky-600', 'bg-indigo-900'],
  ['hover:bg-sky-500', 'hover:bg-indigo-800'],
  ['text-sky-400', 'text-indigo-900'],
  ['text-sky-300', 'text-indigo-700'],
];

for (const [from, to] of replacements) {
  content = content.split(from).join(to);
}

fs.writeFileSync('src/App.tsx', content);
console.log('Done final replacements 2');
