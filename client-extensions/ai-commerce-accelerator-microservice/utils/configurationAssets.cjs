const fs = require('fs');
const path = require('path');

const MICROSERVICE_DIR = path.join(__dirname, '..');

const PROMPTS_DIR = 'prompts';
const PROMPT_EXTENSION = '.md';

const SCHEMAS_DIR = 'generation-schemas';
const SCHEMA_EXTENSION = '.json';

function listAssetNames(directory, extension) {
  try {
    return fs
      .readdirSync(path.join(MICROSERVICE_DIR, directory))
      .filter((fileName) => fileName.endsWith(extension))
      .map((fileName) => path.basename(fileName, extension))
      .sort();
  } catch {
    return [];
  }
}

/**
 * The `generateBatchFiles` Gradle task seeds one AICAConfiguration entry per
 * file in these two directories, so the directories - not a hand-maintained
 * list - decide what should exist in Liferay. Three separate lists had already
 * drifted apart from each other and from the files on disk.
 *
 * The two sets are deliberately different: every prompt has a file in
 * `prompts/`, but only generators that return structured output have one in
 * `generation-schemas/`. Image generation returns an image, so `image.md`
 * exists with no `image.json` behind it - treating the sets as interchangeable
 * would report a permanently missing image schema.
 *
 * These resolve against the shipped directories rather than the runtime
 * `PROMPTS_DIR` override, because the question they answer is "what did the
 * batch seed?", and the batch always reads what ships in the image.
 */
const listPromptNames = () => listAssetNames(PROMPTS_DIR, PROMPT_EXTENSION);

const listSchemaNames = () => listAssetNames(SCHEMAS_DIR, SCHEMA_EXTENSION);

module.exports = { listPromptNames, listSchemaNames };
