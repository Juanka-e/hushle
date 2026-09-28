import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

const script = "scripts/run-paytr-refund-sandbox-acceptance.ts";
const source = readFileSync(script, "utf8");
assert.match(source, /I_UNDERSTAND_THIS_CREATES_A_TEST_REFUND/);
assert.match(source, /sandbox_acceptance_database_not_allowed/);
assert.match(source, /sandbox_acceptance_production_runtime_forbidden/);
assert.match(source, /requesterUserId === reviewerUserId/);
assert.match(source, /adminCount !== 2/);
assert.match(source, /before\.paymentAmountMinor !== order\.totalAmountMinor/);
assert.match(source, /before\.currency !== order\.currency/);
assert.match(source, /before\.testMode/);
assert.match(source, /refund\.amountMinor !== order\.totalAmountMinor/);
assert.match(source, /refund\.completed/);

const rejected = spawnSync(process.execPath, ["--import", "tsx", script], {
    encoding: "utf8",
    env: {
        ...process.env,
        DATABASE_URL: "mysql://root:root@127.0.0.1:3307/tabu_test",
        PAYTR_REFUND_MODE: "sandbox",
        PAYTR_CHECKOUT_MODE: "sandbox",
        PAYTR_MERCHANT_ID: "123456",
        PAYTR_MERCHANT_KEY: "test-key",
        PAYTR_MERCHANT_SALT: "test-salt",
        PAYTR_REFUND_SANDBOX_ACCEPTANCE_CONFIRM: "wrong",
    },
});
assert.equal(rejected.status, 1);
assert.match(rejected.stderr, /sandbox_acceptance_confirmation_required/);
assert.doesNotMatch(rejected.stderr, /test-key|test-salt/);

const productionRejected = spawnSync(process.execPath, ["--import", "tsx", script], {
    encoding: "utf8",
    env: {
        ...process.env,
        NODE_ENV: "production",
        DATABASE_URL: "mysql://root:root@127.0.0.1:3307/tabu_test",
        PAYTR_REFUND_SANDBOX_ACCEPTANCE_CONFIRM: "I_UNDERSTAND_THIS_CREATES_A_TEST_REFUND",
    },
});
assert.equal(productionRejected.status, 1);
assert.match(productionRejected.stderr, /sandbox_acceptance_production_runtime_forbidden/);

const databaseRejected = spawnSync(process.execPath, ["--import", "tsx", script], {
    encoding: "utf8",
    env: {
        ...process.env,
        NODE_ENV: "test",
        DATABASE_URL: "mysql://root:root@127.0.0.1:3307/hushle",
        PAYTR_REFUND_SANDBOX_ACCEPTANCE_CONFIRM: "I_UNDERSTAND_THIS_CREATES_A_TEST_REFUND",
    },
});
assert.equal(databaseRejected.status, 1);
assert.match(databaseRejected.stderr, /sandbox_acceptance_database_not_allowed/);

console.log("PayTR refund sandbox acceptance safety contract checks passed");
