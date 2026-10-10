/** Run the storage contract under Bun or Node; every case owns a disposable directory. */
import { privateJsonFileCases, runPrivateJsonFileCase } from "../src/shared/testing/private-json-file-cases.ts";

for (const testCase of privateJsonFileCases) {
    runPrivateJsonFileCase(testCase);
    console.log(`PASS ${testCase.name}`);
}
console.log(`${privateJsonFileCases.length} portable JSON filesystem checks passed`);
