import { access, readFile } from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();
const metadata = JSON.parse(await readFile(path.join(root, 'metadata.json'), 'utf8'));
const explanations = JSON.parse(await readFile(path.join(root, 'explanations.json'), 'utf8'));

const questions = metadata.questions ?? [];
const missingImages = [];
const missingExplanations = [];

for (const question of questions) {
  try {
    await access(path.join(root, question.file));
  } catch {
    missingImages.push(question.file);
  }

  const explanation = explanations[String(question.year)]?.[String(question.question)];
  if (!explanation) {
    missingExplanations.push(`${question.year}-${question.question}`);
  }
}

console.log(`questions: ${questions.length}`);
console.log(`missing images: ${missingImages.length}`);
console.log(`missing explanations: ${missingExplanations.length}`);

if (missingImages.length || missingExplanations.length || questions.length !== 300) {
  if (missingImages.length) console.log(`missing image examples: ${missingImages.slice(0, 10).join(', ')}`);
  if (missingExplanations.length) console.log(`missing explanation examples: ${missingExplanations.slice(0, 10).join(', ')}`);
  process.exit(1);
}
