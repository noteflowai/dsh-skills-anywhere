// Decode the actual on-demand walkthrough and load its four caption cues.
const assert = require("node:assert/strict");
async function checkAIWalkthrough(app, requests) {
  const panel = app.locator("#ai-first-review");
  const video = panel.locator("video");
  assert.equal(await video.getAttribute("autoplay"), null);
  assert.equal(await video.getAttribute("preload"), "none");
  assert(!requests.some(url => new URL(url).pathname.endsWith("/ai-first-review.mp4")),
    "The walkthrough must not request video bytes before play");
  await panel.locator("summary").click();
  const playback = await video.evaluate(async element => {
    element.textTracks[0].mode = "hidden";
    await element.play();
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Walkthrough playback stalled")), 15000);
      element.addEventListener("timeupdate", () => { clearTimeout(timer); resolve(); }, {once:true});
    });
    element.pause();
    return {duration:element.duration, time:element.currentTime, width:element.videoWidth};
  });
  assert(Math.abs(playback.duration - 30) < 0.2 && playback.time > 0 && playback.width === 1000);
  const track = video.locator("track");
  await track.evaluate(element => element.readyState === 2 ? undefined : new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Captions did not load")), 10000);
    element.addEventListener("load", () => {clearTimeout(timer); resolve();}, {once:true});
    element.addEventListener("error", () => {clearTimeout(timer); reject(new Error("Caption load failed"));}, {once:true});
  }));
  assert.equal(await track.evaluate(element => element.track.cues.length), 4);
  assert.equal(await panel.locator('a[href*="/blob/main/docs/first-"]').count(), 1);
  await panel.locator("summary").click();
}
module.exports = {checkAIWalkthrough};
