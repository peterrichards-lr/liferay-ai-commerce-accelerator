const fs = require('fs');
const file =
  '/Volumes/SanDisk/repos/liferay-accelerator-sdk/src/liferay/rest.cjs';
let data = fs.readFileSync(file, 'utf8');
data = data.replace(
  /\/\/ ERC-scoped endpoints require priceListId in the body due to a platform validation bug\.\n\s+if \(!isERC\) \{\n\s+delete entryData\.priceListId;\n\s+\} else \{\n\s+\/\/ Vulcan Batch Engine \(which backs the ERC-scoped POST\) strictly requires the parent\n\s+\/\/ ERC in the payload to resolve the relationship\.\n\s+entryData\.priceListExternalReferenceCode = priceListIdOrERC;\n\s+\}/g,
  `// Clean up IDs to avoid Vulcan Batch Engine NotSupportedException mapping bugs
    delete entryData.priceListId;
    delete entryData.priceListExternalReferenceCode;`
);
fs.writeFileSync(file, data);
