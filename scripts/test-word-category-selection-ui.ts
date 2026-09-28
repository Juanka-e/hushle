import assert from "node:assert/strict";
import {
    describeBulkCategoryAssignment,
    resolveWordCategoryToggle,
    type CategorySelectionTreeNode,
} from "../apps/web/src/lib/words/category-selection-ui";

const categories: CategorySelectionTreeNode[] = [
    {
        id: 1,
        name: "Hayvanlar",
        children: [
            { id: 11, name: "Kuslar" },
            { id: 12, name: "Deniz Canlilari" },
        ],
    },
];

assert.deepEqual(resolveWordCategoryToggle([], 1, categories).nextSelection, [1]);
assert.deepEqual(resolveWordCategoryToggle([1], 11, categories).nextSelection, [11]);
assert.deepEqual(resolveWordCategoryToggle([11, 12], 1, categories).nextSelection, [1]);
assert.match(describeBulkCategoryAssignment("1", "", categories), /genel havuza/);
assert.match(describeBulkCategoryAssignment("1", "11", categories), /yalniz alt kategoriyi kullanir/);

console.log("word-category-selection-ui smoke test passed");
