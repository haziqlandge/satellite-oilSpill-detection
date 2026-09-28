# SlickTrace demo, teleprompter

**[Q]** means press Q. *Italics* are what should be on screen, don't read them.
Everything else, read out loud. Z quits anything, anytime.

Before you start: hard reload plain `#/console` (Ctrl + Shift + R), keep
`00016.tif` ready, press K once to check the names on the thank you screen,
then Z.

---

### Opening

*Console open, hands off the keyboard.*

Hello everyone, we are Team Dead Braincells.

Today I'll be giving you the demo for SIH problem statement 26143, from NTRO,
under Disaster Management.

What you're looking at right now is the console of our project, SlickTrace.
We'll come back to it in a minute.

But first, let's dive a little deeper into the problem statement. What it's
actually asking us to do, and how we solved each part of it.

---

### Problem statement

**[T]** *screen goes dark*

**[Q]** *Problem Statement pill*

So, the problem statement.

**[Q]** *the statement comes in*

Leveraging satellite imagery to determine oil spills at sea, along with AIS
data correlation, to identify the vessel responsible for the spill.

If I had to explain it in one line, basically: take a satellite image, find
the oil spill, overlay the ship traffic, and rank which ship most likely
caused it.

**[Q]** *Statement rolls into Objectives*

So let's see what it actually wants from us. Five objectives.

**[Q]** *Detect*

First, detect the oil spill.

Now, the sea is full of dark patches on radar. Low wind, algae, ship wakes,
they all look just like oil.

So the real challenge isn't finding dark patches. It's telling actual oil
apart from these lookalikes.

**[Q]** *Characterise*

Second, characterise the slick. Basically, how big is it, what shape, how
long, how wide, and roughly how old.

**[Q]** *Trace back*

Third, trace it back.

Sentinel-1 only passes over the same spot every 6 to 12 days. So by the time
we see the slick, the wind and currents have already carried the oil away
from where it started.

So we have to run it backwards and find where, and when, it actually began.

**[Q]** *Predict*

Fourth, predict. Same idea, but forward. Where is the oil going to drift
next, and which shore does it reach.

**[Q]** *Attribute*

And finally, attribute. Pull up all the ship traffic around the origin, drop
the ships that couldn't have done it, and rank the suspicious ones.

And that includes dark vessels, the ones that switched their AIS off.

---

### Proposed solution

**[Q]** *objectives slide left, Proposed Solution comes in*

Now let me show you our proposed solution. This is how we solved each of
these objectives.

**[Q]** *Model Trained on Real SAR*

To detect the spill, we trained our own model on real SAR images. Over 4,200
Sentinel-1 tiles from the Zenodo datasets.

And since lookalikes are the real problem, we deliberately put 872 lookalike
tiles into training. That brought false alarms on lookalikes down from 55 to
just 4 out of 87.

**[Q]** *it stacks, Detect ticks*

**[Q]** *Sliced, then Segmented*

A full SAR scene is way too big to throw at a GPU in one go. So we slice it
into 1024 pixel tiles with a little overlap, basically the SAHI approach, run
the model on every tile, and stitch the masks back together.

That mask, 91% confidence here, directly gives us the area, length, width
and an age window.

**[Q]** *it stacks, Characterise ticks*

**[Q]** *Wind and Currents on Demand*

To trace anything, we need the real weather. So for the exact place and the
exact hour of the satellite pass, we fetch wind from ERA5 and ocean currents
from CMEMS.

**[Q]** *it stacks, Trace back ticks*

**[Q]** *OpenDrift, Both Ways*

Then OpenDrift does the physics. It simulates how the oil moves on that wind
and current.

And we don't just guess one point. We run 10 simulations of 200 particles
each. 72 hours back to find the likely origin, and 72 hours forward to see
where it's headed.

**[Q]** *it stacks, Predict ticks*

**[Q]** *Runs Locally on User-GPU*

And the model runs locally, right in the browser, on the user's own GPU.
About 9 seconds for the model, 10 to 25 seconds for the whole thing end to
end. No server GPU needed.

**[Q]** *it stacks*

**[Q]** *AIS in the Origin Window*

For the ships, we rebuild the AIS traffic around that origin window and
overlay it on the SAR image.

Any ship that was never in the drift field at the right time gets dropped.
And ships that switched their AIS off, we still pick up as radar contacts in
the image itself.

**[Q]** *it stacks*

**[Q]** *Six Factor Score*

Every ship that's left gets scored on six factors. Drift, parity, proximity,
timing, behaviour, and vessel prior, which is basically the type of vessel.

Every score shows its reasoning on the map, and the top scorer becomes our
most suspected vessel.

**[Q]** *it stacks, Attribute ticks*

And that covers all five objectives.

**[Q]** *a circle opens onto the console*

Now let me show you the console. First, I'll run through a simulated spill.

---

### Live console

*SPILL dropdown, pick Anchored after a collision.*

So this is one of our simulated scenarios. A tanker anchored off Ennore, in
the Bay of Bengal, after a collision. It goes through the exact same pipeline
as a real run, we just built the scenario ourselves.

*Space to play.*

This bar at the bottom is time. Zero is the moment the satellite passed.
Going left is back in time, going right is forward.

Behind the slick you've got the hindcast, basically where the oil could have
come from. Ahead of it is the forecast, where it's going next.

These arrows are the wind and the ocean current, and these cards give you
the actual numbers.

And these are the ships, moving along their tracks hour by hour. The ones
that crossed the origin area at the right time become candidates. The rest
get ruled out.

*Open 04 Attribute, then 05 Evidence.*

Here's the ranking. And this is the evidence for the top ship. Every factor,
its score, and where it comes from on the map.

So the analyst isn't just told which ship. They can see why.

---

### Uploading a SAR image

Now let's see how the model behaves on a SAR image uploaded by the user.

*Add Image, drop 00016.tif. Model Timing opens by itself.*

The Model Timing pane tracks every stage live. Reading the image, loading the
model, and then the inference itself, on the GPU through WebGPU.

*When it finishes, read the real numbers off the pane.*

So the model took about ___ seconds, and the whole thing end to end about ___
seconds.

*Point at the mask.*

And here's the mask. The model has traced the slick, with its confidence
right here.

The location comes straight out of the GeoTIFF, so it lands on the exact
spot on the map.

*Point at the AIS line in Model Timing.*

Now, you'll notice AIS says nothing was found for this place and day. That's
expected.

Free historic AIS basically only exists for US waters, through
MarineCadastre, and we host the Gulf of Mexico days we tested on. For
anywhere else, there's just no free feed.

So here the console fills in simulated ships and marks them as simulated.
Plug in a licensed feed like Spire or Global Fishing Watch, and it drops
straight in.

*Play the timeline.*

And now it drifts on real ERA5 wind and CMEMS currents, fetched for this
exact place and time, backwards and forwards.

---

### Technical approach

So that's it working live. Now let's look at the technical approach,
basically how we actually built it, step by step.

**[X]** then **[Q]** *pill and step bar*

We'll follow one real satellite pass all the way through, from the raw image
to a suspected ship.

**[Q]** *Acquire*

This is a real Sentinel-1A pass over the Gulf of Mexico, from 15 May 2023.
The time and position come straight from the file itself, nothing typed in
by hand.

**[Q]** *Clean*

Raw SAR is really noisy. So first we calibrate it, filter out the speckle,
mask the land, and convert it to decibels.

And this is why the model reads VV. Oil shows about 7 dB of contrast in VV,
and barely half a dB in VH.

**[Q]** *Slice*

Then the scene gets cut into 1024 pixel tiles with 10% overlap. This counter
is how many tiles this one scene turns into.

**[Q]** *Segment*

The model runs on every tile. The tiles with oil light up, the masks fill
in, 237 detections in this one scene. Now we zoom in on one slick and follow
it.

**[Q]** *Measure*

From that one mask we measure everything. Area 4 square kilometres, length
8.5 kilometres, width 462 metres. Plus which end is the head, which is the
tail, and an age window for how long it's been out there.

**[Q]** *Weather Data*

Now the weather. ERA5 gives us the wind, CMEMS gives us the ocean current,
for this exact spot, every hour, 72 hours either side of the pass.

**[Q]** *Hindcast*

Hindcast. 2,000 particles run 72 hours backwards on that wind and current.
Where they bunch up is the origin area. The inner ring holds 50% of them,
the outer ring 90%.

**[Q]** *Forecast*

Forecast is the same thing, forward. 72 hours ahead, this is where it's
headed.

**[Q]** *Gate*

Now the ships. 615 AIS tracks were around during that window. Only 15 were
actually inside the origin area at the right time, so the rest get dropped.

These 9 are radar contacts with no AIS at all. So a dark ship doesn't get a
free pass.

**[Q]** *Score*

Every candidate is scored the exact same way, on the six factors. The top
one scores 0.76, and the next best is way behind at 0.36.

That gap is why we're confident calling it the most suspected vessel.

**[Q]** *Timing*

And speed. This is a measured run in the browser. 22.7 seconds end to end,
and the model itself is only 9.1 seconds of that, on the user's own GPU.

91% confidence on this slick, and it rejects 95% of lookalikes it has never
seen before.

---

### Tech stack

**[Q]** *the stack comes in*

Quickly, our tech stack.

**[Q]** For data, Sentinel-1 imagery, the Zenodo SAR datasets, ERA5 and CMEMS
for the weather, and MarineCadastre for AIS.

**[Q]** For ML, PyTorch and YOLO11 with LSK attention, running in the browser
on ONNX Runtime Web.

**[Q]** For physics, ESA SNAP to clean the image, OpenDrift for the drift,
and CFAR to spot ships on radar.

**[Q]** For the backend, Python with FastAPI, and Supabase for the database.

**[Q]** And for the frontend, React and TypeScript, MapLibre for the map,
deployed on Vercel.

---

### Thank you

**[Q]** *thank you screen*

And that's SlickTrace.

Thank you from Team Dead Braincells, team ID 161987, problem statement
SIH 26143.

You can scan the QR to open our repo. Happy to take any questions.

*Z when you're done.*
