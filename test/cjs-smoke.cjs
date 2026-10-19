const assert = require("node:assert");

const lib = require("@droidsolutions-oss/amqp-ts");
assert.strictEqual(typeof lib.Connection, "function");
assert.strictEqual(typeof lib.Message, "function");

assert.throws(() => require.resolve("@droidsolutions-oss/amqp-ts/lib/Message.js"), {
  code: "ERR_PACKAGE_PATH_NOT_EXPORTED",
});

console.log("cjs smoke test passed");
