const fs = require('fs');
const path = require('path');

// Simple strict JSON parser using regex to detect duplicate keys at the top level
// or we can use a simpler approach: just check for duplicates in the raw string
// or better yet, we can just use a simple regex approach on package.json files.

const filesToCheck = [
    'package.json',
    'client-extensions/ai-commerce-accelerator-microservice/package.json',
    'client-extensions/ai-commerce-accelerator-configuration/package.json',
    'client-extensions/ai-commerce-accelerator-frontend/package.json',
    'client-extensions/liferay-accelerator-sdk/package.json'
];

let hasError = false;

function checkDuplicateKeys(filePath) {
    const fullPath = path.resolve(__dirname, '..', filePath);
    if (!fs.existsSync(fullPath)) return;

    const content = fs.readFileSync(fullPath, 'utf8');
    
    // Quick and dirty check using regex to find duplicate keys in the same block
    // A more robust approach is to parse the JSON and track keys.
    // We can use a custom reviver function in JSON.parse to detect duplicate keys!
    
    try {
        const seenKeys = new Set();
        let isDuplicateFound = false;

        // Custom parser to catch duplicates
        // This is a naive implementation but works for package.json structure
        const lines = content.split('\n');
        const keyRegex = /^\s*"([^"]+)"\s*:/;
        
        let currentDepth = 0;
        const stack = [new Set()];

        lines.forEach((line, index) => {
            if (line.includes('{')) {
                currentDepth++;
                stack.push(new Set());
            }
            
            const match = line.match(keyRegex);
            if (match) {
                const key = match[1];
                const currentSet = stack[stack.length - 1];
                if (currentSet.has(key)) {
                    console.error(`Error: Duplicate JSON key "${key}" found in ${filePath} at line ${index + 1}`);
                    isDuplicateFound = true;
                    hasError = true;
                }
                currentSet.add(key);
            }

            if (line.includes('}')) {
                currentDepth--;
                stack.pop();
            }
        });

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
