"use strict";
const {createHash, randomUUID} = require("node:crypto");
function guardError(code, message) { const error = new Error(message); error.code = code; return error; }
function authorize(auth, allowedEmails) {
  const email = String(auth && auth.token && auth.token.email || "").toLowerCase();
  if (!auth) throw guardError("unauthenticated", "Sign in before generating.");
  if (!auth.token || auth.token.email_verified !== true || !allowedEmails.includes(email)) {
    throw guardError("permission-denied", "Generation is restricted to the configured owner accounts.");
  }
}
async function guardedGeneration({db, uid, feature, period, cap, requestId, input}, work) {
  if (!Number.isInteger(cap) || cap < 1) throw guardError("failed-precondition", "Generation limit is not configured correctly.");
  const id = requestId || randomUUID();
  if (!/^[a-zA-Z0-9_-]{8,100}$/.test(id)) throw guardError("invalid-argument", "Invalid request ID.");
  const digest = value => createHash("sha256").update(value).digest("hex");
  const ref = db.collection("generation-requests").doc(digest(uid + ":" + feature + ":" + id));
  const budget = db.collection("generation-budgets").doc(digest(uid + ":" + feature + ":" + period));
  const fingerprint = digest(JSON.stringify(input));
  const existing = await db.runTransaction(async tx => {
    const prior = await tx.get(ref);
    if (prior.exists) {
      const data = prior.data();
      if (data.fingerprint !== fingerprint) throw guardError("invalid-argument", "Request ID was already used for different input.");
      if (data.status === "complete") return data.result;
      throw guardError("failed-precondition", data.status === "running" ? "This generation is already running. Do not submit it again." : "This attempt failed or its outcome is uncertain. Check the report list before starting a new attempt.");
    }
    const snap = await tx.get(budget);
    const count = snap.exists ? Number(snap.data().count || 0) : 0;
    if (count >= cap) throw guardError("resource-exhausted", "Generation attempt limit reached for this period (" + cap + ").");
    tx.set(budget, {uid, feature, period, count:count + 1, updated:Date.now()});
    tx.set(ref, {uid, feature, fingerprint, status:"running", created:Date.now()});
    return null;
  });
  if (existing) return existing;
  try {
    const result = await work(id);
    await ref.set({status:"complete",result,updated:Date.now()}, {merge:true});
    return result;
  } catch (error) {
    // An upstream timeout can still have incurred cost. Keep the reservation;
    // never automatically repeat a paid request whose outcome is uncertain.
    await ref.set({status:"failed",updated:Date.now()}, {merge:true}).catch(() => {});
    throw error;
  }
}
module.exports = {authorize, guardedGeneration};
