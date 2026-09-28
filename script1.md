# Demo script: SIH26143, Team Dead Braincells

**How to read this**

- **[DO]** is what you press or click. Everything else is what you say.
- It's a guide, not a teleprompter. Say it your way, just hit the points.
- In T and X every card waits for your Q. Talk first, then press.
- Q while something is still animating snaps it to the end. Z quits anything,
  anytime. K shows or hides the names on the last screen.

**Rough timing, about 12 minutes**

| Part | Time |
|---|---|
| 0. Opening | 30 s |
| 1. Problem and solution (T) | 3.5 min |
| 2. Live console, simulated spill | 2 min |
| 3. Uploading a SAR image | 2 min |
| 4. Technical approach (X) | 3.5 min |
| 5. Tech stack | 20 s |
| 6. Thank you | 15 s |

**Before you start**

- Hard reload the console on plain `#/console` (Ctrl + Shift + R).
- Keep `00016.tif` ready to drop in for part 3.
- Press K once and check the names show on the thank you screen, then Z.

---

## 0. Opening (console on screen)

**[DO]** Console open, hands off the keyboard.

> Hello everyone, we're Team Dead Braincells, and today I'll be giving you the
> demo for SIH problem statement SIH26143, from NTRO, under Disaster
> Management.
>
> What you see behind me is our console, SlickTrace. We'll come back to it in
> a bit. But before we jump into the live demo, let's first dive a little
> deeper into the problem statement, what it's actually asking us to do, and
> how we've solved each part of it.

---

## 1. Problem statement and proposed solution

**[DO]** T. The screen goes dark.

**[DO]** Q, the Problem Statement pill.

> So, the problem statement.

**[DO]** Q, the statement comes in.

> In one line: use satellite imagery to find oil spills at sea, and then use
> AIS data, which is the transponder signal every big ship broadcasts, to
> figure out which vessel actually caused it.
>
> And why it matters: spills wreck marine life, and most of the time nobody
> ever finds out who did it. By the time anyone sees the slick, the ship is
> long gone.

**[DO]** Q, "Statement" rolls into "Objectives".

> So we broke it down into five things we actually have to do.

**[DO]** Q, Detect.

> First, detect. Find the slick in the radar image. And the hard part isn't
> finding dark patches, the sea is full of them. Low wind, algae, ship wakes,
> they all look like oil on radar. The real job is telling oil apart from the
> look-alikes.

**[DO]** Q, Characterise.

> Second, characterise. How big is it, what shape, how long, how wide, and
> roughly how old. The age tells us how far back in time we need to look.

**[DO]** Q, Trace back.

> Third, trace it back. Oil moves before anyone sees it. Sentinel-1 only
> passes over the same spot every 6 to 12 days, so by then wind and currents
> have already carried the oil away. So we run it backwards to find where and
> when it started.

**[DO]** Q, Predict.

> Fourth, predict. Same physics, forward. Where it goes next, and which coast
> it hits.

**[DO]** Q, Attribute.

> And fifth, the one that really matters, attribute. Pull up the ship traffic
> around that origin, throw out the ships that couldn't have done it, and
> score the rest.

**[DO]** Q, the objectives move left and Proposed Solution comes in.

> And this is how we solved each one.

**[DO]** Q, Model Trained on Real SAR lands.

> We trained our own model on real Sentinel-1 radar images. It's YOLO11 with
> an attention block called LSK, trained on over four thousand tiles, and we
> deliberately fed it 872 look-alike tiles. That took false alarms on
> look-alikes from 55 down to just 4 out of 87.

**[DO]** Q, it stacks and Detect ticks.

**[DO]** Q, Sliced, then Segmented lands.

> A full radar scene is huge, way too big for a model in one go. So we slice
> it into 1024 pixel tiles with a little overlap, run the model on every
> tile, and stitch the masks back together. Here it's 91% confident, and from
> that mask we get the area, length, width and an age window directly.

**[DO]** Q, it stacks and Characterise ticks.

**[DO]** Q, Wind and Currents on Demand lands.

> To trace anything we need the real weather. So for the exact place and the
> exact hour of the satellite pass, we pull ERA5 for the wind and Copernicus
> Marine, CMEMS, for the ocean currents.

**[DO]** Q, it stacks and Trace back ticks.

**[DO]** Q, OpenDrift, Both Ways lands.

> Then OpenDrift does the physics. We don't guess one point. We run 10
> simulations of 200 particles each, 72 hours back to get a likely origin area
> and time, and 72 hours forward to see where the oil ends up.

**[DO]** Q, it stacks and Predict ticks.

**[DO]** Q, Runs Locally on User-GPU lands.

> And detection runs right in the browser, on the user's own GPU. About 9
> seconds for the model, 10 to 25 seconds for a whole upload. No server GPU
> at all.

**[DO]** Q, it stacks.

**[DO]** Q, AIS in the Origin Window lands.

> For the ships, we rebuild historic AIS around that origin window. Any ship
> that was never in the drift field at the right time gets dropped. And ships
> that switched their AIS off? We still catch them as radar contacts in the
> image itself.

**[DO]** Q, it stacks.

**[DO]** Q, Six Factor Score lands.

> Every ship that's left gets scored on six factors: drift, parity,
> proximity, timing, behaviour and the type of vessel. Every score shows its
> reason on the map, and the top scorer becomes our most suspected vessel.

**[DO]** Q, it stacks and Attribute ticks.

> And that's all five objectives covered.

**[DO]** Q, a circle opens onto the console.

> Now let's go to the console and see it actually running.

---

## 2. Live console: a simulated spill

**[DO]** SPILL dropdown, pick **Anchored after a collision** (Ennore, Bay of
Bengal). Pick **Dark vessel** instead if you'd rather show a ship with its AIS
off.

> Let me load one of our simulated scenarios. This one's a tanker at the
> Ennore anchorage in the Bay of Bengal. Same pipeline as the real runs, just
> a scenario we built.

**[DO]** Space to play. Arrow keys step one hour, Home jumps to the start.

Point, don't read:

- > This bar at the bottom is time. Zero is the moment the satellite passed.
  > Left goes back in time, right goes forward.
- > Behind the slick is the hindcast, where the oil could have come from.
  > Ahead of it is the forecast, where it's going. The key's right here in the
  > corner.
- > The arrows are wind and current. These cards give you the actual numbers.
- > And these are the ships, moving on their tracks hour by hour. The ones that
  > crossed the origin field at the right time become candidates, the rest get
  > ruled out. And a ship that went dark still shows up as a radar contact.

**[DO]** Open **04 Attribute**, then **05 Evidence**.

> This is the ranking, and this is the evidence card for the top ship. Every
> factor, its score, and where it comes from on the map. So an analyst isn't
> just told who, they can see why.

---

## 3. Uploading a SAR image

> Now let's see how the model behaves on a radar image a user uploads.

**[DO]** Open **Add Image** and drop `00016.tif`. The Model Timing pane opens
on its own.

> The Model Timing pane tracks every stage live. Decoding the image, loading
> the model, and then the inference itself, on the GPU through WebGPU.

**[DO]** When it finishes, read the real numbers off the pane.

> So inference took about [9] seconds, and the whole thing end to end about
> [20].

**[DO]** Point at the mask and the map.

> And here's the mask. The model's traced the slick, with its confidence right
> here. The position comes straight out of the GeoTIFF, so it lands on the
> right spot on the map.

**[DO]** Point at the AIS line in Model Timing.

> Now, you'll notice AIS says nothing was found for this place and day. That's
> expected. Free historic AIS only exists for US waters, from MarineCadastre,
> and we host the Gulf days we tested on. For anywhere else there's just no
> free feed, so the console fills in simulated ships and marks them clearly.
> Plug in a licensed feed like Spire or Global Fishing Watch and it drops
> straight in, same format.

**[DO]** Play the timeline.

> And now it drifts on real ERA5 wind and CMEMS currents, fetched for that
> exact place and time, backwards and forwards.

---

## 4. Technical approach

> So that's it working. Now let's see the technical approach, how we actually
> built it, step by step.

**[DO]** X, then Q. The pill and the step bar come in.

> We'll follow one real satellite pass all the way through, from the raw
> image to a suspected ship.

**[DO]** Q, Acquire.

> This is a real Sentinel-1A pass over the Gulf of Mexico, 15 May 2023. Time
> and position come straight from the file, nothing typed in by hand.

**[DO]** Q, Clean.

> Raw radar is super noisy. So we calibrate it, run a speckle filter, mask out
> the land, and convert it to decibels. And this is why the model reads VV:
> oil shows about 7 dB of contrast in VV and barely half a dB in VH.

**[DO]** Q, Slice.

> Then the scene gets cut into 1024 pixel tiles, 10% overlap. The counter's
> showing how many tiles this one scene turns into.

**[DO]** Q, Segment.

> The model runs on every tile. The tiles with oil light up, the masks paint
> in, 237 detections in this one scene, and then we zoom in on one slick to
> follow it.

**[DO]** Q, Measure.

> From that one mask we measure everything. Area 4 square kilometres, length
> 8.5 km, width 462 metres, how much it damps the radar, which end's the head
> and which is the tail, and an age window for how long it's been out there.

**[DO]** Q, Weather Data.

> Now the weather. ERA5 gives us the wind, CMEMS the ocean current, for this
> exact spot, every hour, 72 hours either side of the pass. Those lines are
> the real fields.

**[DO]** Q, Hindcast.

> Hindcast. 2,000 particles run 72 hours backwards on that wind and current.
> Where they bunch up is the origin area. Inner ring 50%, outer ring 90%.

**[DO]** Q, Forecast.

> Forecast, same thing forward. 72 hours ahead, this is where it's headed.

**[DO]** Q, Gate.

> Now the ships. 615 AIS tracks were around during that window. Only 15 were
> actually inside the origin field at the right hour, the rest get dropped.
> These 9 are radar contacts with no AIS, so dark ships don't get a free pass.
> And the red one is our most suspected vessel.

**[DO]** Q, Score.

> Every candidate gets scored the same way, six weighted factors. The top one
> scores 0.76 and the next best is way behind at 0.36. That gap is why we're
> confident calling it the most suspected vessel.

**[DO]** Q, Timing.

> And speed. This is a measured run in the browser. 22.7 seconds end to end,
> and the model itself is only 9.1 of that, on the user's own GPU. It's 91%
> confident on this scene, and it rejects 95% of look-alikes it has never
> seen before.

---

## 5. Tech stack (keep it short)

**[DO]** Q, then Q once per line as you say it.

> Quick look at the stack.
>
> Data: Sentinel-1, the Zenodo SAR datasets, ERA5, CMEMS and MarineCadastre AIS.
>
> ML: PyTorch and YOLO11 with LSK attention, running in the browser on ONNX
> Runtime Web.
>
> Physics: ESA SNAP for the preprocessing, OpenDrift for the drift, and CFAR
> for spotting ships on radar.
>
> Backend: Python, FastAPI and Supabase.
>
> Frontend: React, TypeScript and MapLibre, deployed on Vercel.

---

## 6. Thank you

**[DO]** Q, the thank you screen.

> And that's SlickTrace. Thank you from Team Dead Braincells, team ID 161987,
> problem statement SIH26143. Scan the QR to open our repo. Happy to take any
> questions.

**[DO]** Z when you're done.
