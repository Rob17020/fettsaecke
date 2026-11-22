// Für reminders.test.mjs: stellt die Uhr von send.mjs auf FAKE_NOW (node --import ./fakedate.mjs …)
const Real = Date, fixed = new Real(process.env.FAKE_NOW).getTime();
class FakeDate extends Real { constructor(...a) { if (a.length) super(...a); else super(fixed); } static now() { return fixed; } }
globalThis.Date = FakeDate;
