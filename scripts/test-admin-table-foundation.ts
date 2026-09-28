import assert from "node:assert/strict";
import {
    hasFullSelection,
    matchesAdminSearch,
    paginateItems,
    replaceSelection,
    toggleSelection,
} from "../apps/web/src/lib/admin/admin-table";

const paginated = paginateItems([1, 2, 3, 4, 5], 2, 2);
assert.deepEqual(paginated.items, [3, 4]);
assert.equal(paginated.page, 2);
assert.equal(paginated.pageCount, 3);
assert.equal(paginated.total, 5);

assert.equal(matchesAdminSearch("kamp", ["Kampanya", "Kupon"]), true);
assert.equal(matchesAdminSearch("yok", ["Kampanya", "Kupon"]), false);
assert.equal(matchesAdminSearch("", ["Kampanya"]), true);

const replaced = replaceSelection([2, 4]);
assert.equal(replaced.has(2), true);
assert.equal(replaced.has(1), false);

const toggledOn = toggleSelection(new Set<number>(), 9);
assert.equal(toggledOn.has(9), true);

const toggledOff = toggleSelection(new Set<number>([9]), 9);
assert.equal(toggledOff.has(9), false);

assert.equal(hasFullSelection(new Set([1, 2]), [1, 2]), true);
assert.equal(hasFullSelection(new Set([1]), [1, 2]), false);

console.log("admin table foundation tests passed");
