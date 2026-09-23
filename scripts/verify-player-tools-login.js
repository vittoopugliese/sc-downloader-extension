const assert = require("node:assert/strict");
const accessModule = require("./player-tools-access.js");
const commerceModule = require("./player-tools-commerce.js");

async function verify() {
  let data = {};
  let networkCalls = 0;
  const storage = {
    async get() { return structuredClone(data); },
    async set(value) { data = { ...data, ...structuredClone(value) }; },
  };
  const owner = { tab: { id: 1 }, frameId: 0, documentId: "test-player" };
  function connect() {
    const access = accessModule.create({ storage });
    const commerce = commerceModule.create({
      storage, access, randomUUID: () => "testinstallation123456",
      request: async () => { networkCalls += 1; throw new Error("Offline"); },
    });
    access.configureAuthority({
      startTrial: () => commerce.startTrial(),
      consumeTrial: (value) => commerce.consumeTrial(value),
      ensureEntitlement: (value) => commerce.ensureEntitlement(value),
      validateTrial: (value) => commerce.validateTrial(value),
    });
    return { access, commerce };
  }
  let { access, commerce } = connect();
  assert.equal((await commerce.activateTest({ username: "1", password: "1" })).status, "active");
  assert.equal((await access.getSnapshot(owner)).plan, "pro");
  assert.equal((await access.startTrial()).plan, "pro", "opening Player Tools with Pro must not require the trial service");
  assert.equal((await access.authorize(owner, { operation: "set-eq" })).allowed, true);

  // A popup refresh and a page guard run concurrently, including after a worker restart.
  ({ access, commerce } = connect());
  const [popup, player] = await Promise.all([
    commerce.getState({ revalidate: true }),
    access.getSnapshot(owner),
  ]);
  assert.equal(popup.status, "active");
  assert.equal(player.plan, "pro");
  await Promise.all([commerce.activateTest({ username: "1", password: "1" }), access.getSnapshot(owner)]);
  await Promise.all([commerce.deactivateTest(), access.getSnapshot(owner)]);
  assert.equal((await access.getSnapshot(owner)).plan, "free");
  assert.equal(networkCalls, 0, "local Pro login, opening, refresh and logout must work offline");
}

const timeout = setTimeout(() => {
  console.error("Player Tools login timed out: commerce and access queues must not deadlock.");
  process.exit(1);
}, 3000);
verify().then(() => {
  clearTimeout(timeout);
  console.log("Player Tools integrated test login verification passed.");
}).catch((error) => {
  clearTimeout(timeout);
  console.error(error);
  process.exitCode = 1;
});
