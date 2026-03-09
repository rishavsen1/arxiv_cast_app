import fs from 'fs';

let content = fs.readFileSync('src/App.tsx', 'utf-8');

const replacements = [
  ['bg-[#fcfcfc]', 'bg-[#f9f8f6]'],
  ['text-gray-900', 'text-[#2c2c2a]'],
  ['text-gray-800', 'text-[#4a4a48]'],
  ['text-gray-600', 'text-[#5c5c5a]'],
  ['text-gray-500', 'text-[#7a7a78]'],
  ['border-gray-200', 'border-[#e5e3db]'],
  ['border-gray-300', 'border-[#d5d3cb]'],
  ['bg-gray-100', 'bg-[#f0eee6]'],
  ['bg-gray-200', 'bg-[#e5e3db]'],
  ['bg-gray-50', 'bg-[#f5f4ef]'],
  ['text-indigo-900', 'text-[#3a3a38]'],
  ['text-indigo-700', 'text-[#5a5a58]'],
  ['text-indigo-600', 'text-[#7a7a78]'],
  ['bg-indigo-900', 'bg-[#3a3a38]'],
  ['hover:bg-indigo-800', 'hover:bg-[#2c2c2a]'],
  ['focus:ring-indigo-600', 'focus:ring-[#5a5a58]'],
  ['focus:border-indigo-600', 'focus:border-[#5a5a58]'],
];

for (const [from, to] of replacements) {
  content = content.split(from).join(to);
}

fs.writeFileSync('src/App.tsx', content);
console.log('Done refining classes');
