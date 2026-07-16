const fs = require('fs');
const path = require('path');

// Target package.json files
const filesToCheck = [
  'package.json',
  'client-extensions/ai-commerce-accelerator-microservice/package.json',
  'client-extensions/ai-commerce-accelerator-configuration/package.json',
  'client-extensions/ai-commerce-accelerator-frontend/package.json',
];

let hasError = false;

function checkDuplicateKeys(filePath) {
  const fullPath = path.resolve(__dirname, '..', filePath);
  if (!fs.existsSync(fullPath)) return;

  const content = fs.readFileSync(fullPath, 'utf8');

  try {
    let isDuplicateFound = false;
    let inString = false;
    let escapeNext = false;
    let currentDepth = 0;
    const stack = [new Set()];

    let currentString = '';
    let readingKey = false;

    for (let i = 0; i < content.length; i++) {
      const char = content[i];

      if (escapeNext) {
        escapeNext = false;
        if (inString) currentString += char;
        continue;
      }

      if (char === '\\') {
        escapeNext = true;
        if (inString) currentString += char;
        continue;
      }

      if (char === '"') {
        inString = !inString;
        if (!inString) {
          // String ended. Let's see if the next non-whitespace char is a colon.
          let j = i + 1;
          while (j < content.length && /\s/.test(content[j])) j++;
          if (content[j] === ':') {
            // This was a key
            const currentSet = stack[stack.length - 1];
            if (currentSet.has(currentString)) {
              console.error(
                `Error: Duplicate JSON key "${currentString}" found in ${filePath} at depth ${currentDepth}`
              );
              isDuplicateFound = true;
              hasError = true;
            }
            currentSet.add(currentString);
          }
        } else {
          currentString = '';
        }
        continue;
      }

      if (inString) {
        currentString += char;
        continue;
      }

      if (char === '{') {
        currentDepth++;
        stack.push(new Set());
      } else if (char === '}') {
        currentDepth--;
        stack.pop();
      }
    }

    if (!isDuplicateFound) {
      console.log(`✅ No duplicate keys in ${filePath}`);
    }
  } catch (err) {
    console.error(`Error parsing ${filePath}:`, err.message);
    hasError = true;
  }
}

filesToCheck.forEach(checkDuplicateKeys);

if (hasError) {
  console.error('❌ JSON duplicate key validation failed.');
  process.exit(1);
} else {
  console.log('✅ JSON duplicate key validation passed.');
}
