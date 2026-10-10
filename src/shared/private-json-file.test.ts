import { privateJsonFileCases, runPrivateJsonFileCase } from "./testing/private-json-file-cases.ts";

for (const testCase of privateJsonFileCases) {
    Deno.test(testCase.name, () => runPrivateJsonFileCase(testCase));
}
