import assert from "node:assert/strict";
import { prisma } from "../apps/web/src/lib/prisma";

assert.equal(Boolean(prisma.discountCampaign.fields), true);
assert.equal("usageLimit" in prisma.discountCampaign.fields, true);
assert.equal(Boolean(prisma.couponCode.fields), true);
assert.equal("usageLimit" in prisma.couponCode.fields, true);

console.log("promotion field reference smoke test passed");
