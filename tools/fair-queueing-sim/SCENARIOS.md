# Fair queueing scenarios, for review

Harmony shares each backend service's pods between the users who want it ("fair queueing"). We
compare ways of doing that in a simulator, on the 17 scenarios below. The scenarios decide what
counts as "better", so before changing how Harmony shares its services, we'd like people who know
Harmony's real users and workloads to check them.

**What we're asking:** for each scenario, is the situation realistic, and is "what should happen"
what Harmony wants? Each one ends with a specific question. Answers in comments are welcome, short
or long. The answers so far, and what we'll change because of them, are in
[Feedback so far](#feedback-so-far).

## At a glance

Every scenario is one service with 20 pods, except 13, which has two services, and 14-17, which
have 125 pods like production.

| # | The situation | What should happen | Question for you |
|---|---|---|---|---|
| [1](#1-one-user-alone) | One user, one big job | The user gets every pod | Is a minute's delay at the start of a new job acceptable? |
| [2](#2-a-sync-request-behind-a-big-job) | A sync request arrives while another user's big job fills the service | The request finishes in about its own run time | Is there a response time sync users expect? |
| [3](#3-a-sync-request-behind-the-users-own-job) | A user's sync request arrives while their own big job is queued | The request doesn't wait behind their own job | Should sync requests always go first? |
| [4](#4-a-crowded-service) | Eight users with very different work item lengths | Everyone gets a fair share | Is "fair" best measured in pods? |
| [5](#5-a-newcomer) | A new user arrives at a service already shared by six | The newcomer gets going promptly | Should a newcomer get extra for a while? |
| [6](#6-slow-work-and-fast-work) | Slow work (30 minute items) and fast work (1 minute items) compete | Fast work keeps flowing | Are these typical slow and fast durations? |
| [7](#7-slow-work-alone) | Slow work alone | It gets most of the pods; a reserve stays free for fast work | Is that reserve worth what it costs here? |
| [8](#8-one-user-with-many-jobs) | One user with four jobs, one with one | The two users get half each | Should some users get more than an equal share? |
| [9](#9-a-job-that-turns-slow) | A job whose work suddenly gets 20 times slower | It's noticed and limited quickly | Do real jobs change speed like this? |
| [10](#10-a-larger-sync-request) | A 4 granule sync request (production allows 1) | It finishes in about its own run time | Keep this scenario, or drop it? |
| [11](#11-two-new-slow-jobs) | Two new slow jobs, then fast work 5 minutes later | Fast work gets going before the slow jobs take over | Fast work first, or fair from the start? |
| [12](#12-a-job-with-occasional-long-items) | A fast job with occasional long work items | It's treated as fast | Is "1 in 20 items takes 10 times as long" realistic? |
| [13](#13-a-busy-day) | Six hours of mixed users on a two step chain | Everyone's work keeps moving | What does a real busy day look like? |
| [14](#14-hoss-under-a-backlog) | hoss, built from production stats: 125 pods, a permanent backlog, 16 users | Sync requests within 10 seconds, everyone gets an equal share | Does this look like hoss? |
| [15](#15-geoloco-full-with-one-user) | One user keeps geoloco full, as in production; a newcomer arrives | The newcomer gets an equal share soon | Should sync requests have a fast path? |
| [16](#16-a-trajectory-subsetter-burst) | A trajectory-subsetter burst: 11 users, some with minutes-long work items | Everyone gets an equal share, sync within 10 seconds | Does this look like a burst? |
| [17](#17-a-slow-user-arrives-first) | An idle service: a user with 30-60 minute work items arrives first, fast work 5 minutes later | Fast work and sync requests start within seconds | How often does this happen? |

## Feedback so far

### Chris's answers (2026-11-04)

| # | Question | Answer | What it means for the scenarios |
|---|---|---|---|---|
| 1 | Is a minute's delay at the start of a new job acceptable? | No | Real work items are seconds long (see 6), so a new job's first work item finishes in seconds and the delay mostly goes away with realistic durations. Check it once the scenarios use them. |
| 2 | Is there a response time sync users expect? | Yes, less than 10 seconds of latency | Add a goal: a sync request's time to finish minus its own run time under 10 seconds. |
| 3 | Should sync requests always go first? | Yes | Matches what fair share fast lane does. |
| 4 | Is "fair" best measured in pods? | No, it's measured in amount of time using pods | That is what fairness and share measure (pods held, over time), so the question was badly put. It means Carol in 4 really is under-served. |
| 5 | Should a newcomer get extra for a while? | All 7 of them share time evenly | No extra share for newcomers. Change 5's goal to Erin getting an equal share as soon as Erin arrives. |
| 6 | Are 30 minutes and 1 minute typical? | Fast work items are ~1 second. Average 10 seconds, median 4-5 seconds, 95th percentile 1 minute. Outliers 30 minutes to 2 hours. | The scenarios' work items are 10-100 times too long. Rebase every scenario on these durations (better still, on each service's own, from the dashboard). |
| 7 | Is the reserve worth what it costs? | Maybe? Would prefer a much lower reserve of idle pods if possible. | Try smaller reserves (e.g. 10% and 20%) and see what they cost fast work. |
| 8 | Should some users get more than an equal share? | Equal in amount of time using pods | Matches the current goal. |
| 9 | Do real jobs change speed like this? | Rarely - usually in error and retry scenarios where spot instances go away and pods die | 9 overstates how often this happens. Replace it with a scenario of failures and retries. |
| 10 | Keep the 4 granule sync scenario? | No - single granule sync requests only | Drop 10. |
| 11 | Fast work first, or fair from the start? | Not sure what this means - for the same user, round robin between jobs is fine | The question was unclear: Frank, Mia and Gina are three different users. Ask again (below). |
| 12 | Is "1 in 20 items takes 10 times as long" realistic? | Possible for subsetting when there's more or less data, but more likely a work item is occasionally much faster than the others | Add the reverse case: a job whose work items are occasionally much faster. A run of those could make a slow job look fast. |
| 13 | What does a real busy day look like? | Look at the production stats that are being gathered now | Build it from the dashboard's stats. |

**Question 11, asked again:** three different users. Frank and Mia start slow jobs at the same time;
nobody knows yet that the work is slow. Five minutes later Gina starts fast work. Once Frank's and
Mia's work is known to be slow, should the three users share the pods equally straight away, or
should Gina's fast work get more until it's flowing (Gina's job finishing about a third sooner),
with the sharing evening out later?

### Chris's other comments

- **Use 125 pods per service**, which is what production uses now.
- **Use work items as short as 1 second**, especially for sync requests arriving while a large job
  is in progress.
- **A user who submits one single granule async request at a time**, waiting for each to finish
  before sending the next: how is their performance affected?
- **Big-n-bit sends 100 jobs of 1 granule at a time**, then 100 more a minute or two later, for
  hours on end.
- **Take the distributions of request performance from the production dashboard.**
- **Should whole jobs be simulated**, with each finished work item starting the next step in the
  chain and each service taking a different time, so work arrives at the services unevenly? The
  simulator already does this: a job is a chain of steps on different services, and Harmony's own
  work-updater code creates each step's work items as the previous step's finish (scenario 13 does
  this). What it doesn't model is the CMR query step, aggregation and batching.

### What we'll change

1. **Get each service's work item durations, users and job patterns from the dashboard's API**
   (`/admin/dashboard/api/services/<name>`, `/admin/dashboard/api/users/<name>`).
2. **Rebase the scenarios on production:** 125 pods per service, durations from the dashboard (or
   Chris's figures until then), and the 10 second sync goal. At that scale the simulator's delays
   between work items (scheduling, queueing, polling) matter much more, so check them against
   production too.
3. **Apply the answers:** drop 10; change 5's goal; replace 9 with failures and retries; add the
   reverse of 12; ask 11 again.
4. **Add scenarios** for the one-at-a-time user and big-n-bit's bursts. Both need small simulator
   features: a generator that submits a job when the previous one finishes, and one that submits
   jobs in bursts.
5. **Try smaller reserves** - done: a 10% reserve still keeps sync requests within 8 seconds when a
   slow user arrives first (scenario 17), and fair share fast lane now uses it.

## A few terms

- **Pod** - one copy of a service, which processes one work item at a time.
- **Work item** - one granule's processing by one service.
- **Sync request** - a request someone is waiting on interactively; production limits these to
  1 granule.
- **Slow and fast work** - Harmony treats work items over 10 minutes as slow, and lets slow work
  use at most 70% of a service's pods, keeping 30% free so fast work arriving later always finds
  pods. That 30% is the **reserve** - duration-based's. Fair share fast lane keeps 10% instead (see
  Feedback so far, question 7).
- **Times its minimum** - how long a job took compared with the fastest it could possibly finish
  with the service to itself. 1× is as fast as possible; 3× is three times as long.
- **Fairness** - how evenly the competing users shared the service: 1.00 is perfectly even.
- **Share** - a user's pods compared with what they were entitled to: 1.00 is exactly their share.

The full results for fair share fast lane, as it's being promoted, are in [RESULTS.md](RESULTS.md). The results
here compare four ways of sharing: **slot-based** (Harmony's default, which every
production service runs today), **duration-based** (Harmony's alternative, which knows how long
work items take, but isn't used in production), and two candidates to replace slot-based:
**slot-based fair share** (slot-based, plus a rule that holds each user to a fair share of the
pods while others are waiting, and sync requests first - it doesn't need to know how long work
items take) and **fair share fast lane** (built on duration-based; earlier drafts of this
document called it "adaptive"). Each number is an average over 5 runs with different random work
item durations. Lower is better, except for fairness, share and pods busy.

## The scenarios

### 1. One user alone

**The situation:** Alice is the only user, with one job of 600 work items of about 2 minutes each.

**What should happen:** Alice uses every pod, and all three policies do equally well.

| | slot-based | duration-based | slot-based fair share | fair share fast lane |
|---|---|---|---|---|
| Alice's job, times its minimum | 1.03× | 1.03× | 1.03× | 1.04× |
| Pods busy | 97.4% | 97.4% | 97.4% | 96.3% |

Fair share fast lane starts a new job 2 work items at a time until the first one finishes, so that it can't
fill the service before anyone knows whether its work is slow. Here that costs under a minute on a
one hour job.

**Question:** is a minute's delay at the start of a new job an acceptable price for protecting the
service from new slow jobs?

### 2. A sync request behind a big job

**The situation:** Alice's job (600 work items of about 2 minutes) fills the service. Ten minutes
in, Bob sends a 1 granule sync request that takes 1 minute.

**What should happen:** Bob's request finishes close to 1 minute, without noticeably delaying
Alice.

| | slot-based | duration-based | slot-based fair share | fair share fast lane |
|---|---|---|---|---|
| Bob's request, time to finish | 1m 14s | 1m 14s | 1m 13s | 1m 25s |
| Alice's job, time to finish | 1h 05m | 1h 05m | 1h 05m | 1h 05m |

Bob's request has to wait for one of Alice's work items to finish (no policy interrupts running
work), so it can't take exactly 1 minute. All three are about the same.

**Question:** is "close to its own run time" the right goal, or is there a response time sync users
expect?

### 3. A sync request behind the user's own job

**The situation:** Alice and Bob each have a job of 400 work items of about 2 minutes. Ten minutes
in, Bob also sends a 1 granule sync request.

**What should happen:** Bob's request finishes quickly even though Bob's own big job is queued, and
Alice and Bob each get about half the service.

| | slot-based | duration-based | slot-based fair share | fair share fast lane |
|---|---|---|---|---|
| Bob's request, time to finish | 1m 38s | 1m 33s | 1m 10s | 1m 09s |
| Fairness | 0.98 | 0.98 | 0.99 | 0.99 |

Fair share fast lane sends sync requests first, even when that puts the user briefly over their share.

**Question:** should a sync request always go ahead of the same user's other work?

### 4. A crowded service

**The situation:** eight users share the service. Carol's work items take about 30 seconds, Dan's
about 8 minutes, and everyone else's about 2 minutes. Fifteen minutes in, Bob also sends a sync
request.

**What should happen:** every user gets close to their fair share of pods, however long their work
items take, and Bob's request finishes quickly.

| | slot-based | duration-based | slot-based fair share | fair share fast lane |
|---|---|---|---|---|
| Fairness | 0.86 | 0.82 | 0.93 | 0.93 |
| Bob's request, time to finish | 1m 51s | 1m 38s | 1m 48s | 1m 18s |

**Question:** fairness here is measured in pods. Should a user with very short work items (Carol)
count as well served when their work keeps moving, even with fewer pods?

### 5. A newcomer

**The situation:** six users each have a job of 200 work items of about 2 minutes. Twenty minutes
in, Erin submits a small job of 50 one-minute work items.

**What should happen:** Erin's job gets going promptly without starving anyone. (Sharing evenly and
keeping everyone's jobs short pull against each other here: an even split makes equal jobs all
finish late together.)

| | slot-based | duration-based | slot-based fair share | fair share fast lane |
|---|---|---|---|---|
| Erin's job, times its minimum | 9.8× | 10.2× | 8.3× | 6.7× |

Fair share fast lane is better, but no policy gets Erin going promptly yet.

**Question:** should a newcomer get more than an equal share for a while, at the existing users'
expense, or is an equal share from the start right?

### 6. Slow work and fast work

**The situation:** Frank submits 60 work items that take about 30 minutes each. Five minutes later,
Gina and Hank each submit 300 one-minute work items.

**What should happen:** Gina's and Hank's work starts promptly and keeps flowing while Frank's runs.
Frank finishing later is the expected price.

| | slot-based | duration-based | slot-based fair share | fair share fast lane |
|---|---|---|---|---|
| Gina's job, times its minimum | 7.6× | 7.4× | 4.8× | 3.3× |
| Hank's job, times its minimum | 7.4× | 7.2× | 4.7× | 3.3× |

Duration-based barely helps, because Frank's work fills the service before Frank's first work item
finishes and shows it's slow. Fair share fast lane holds new jobs back until it knows, so the reserve works.

**Question:** are 30 minutes and 1 minute typical of Harmony's slow and fast services?

### 7. Slow work alone

**The situation:** Frank is the only user, with 100 work items of about 30 minutes each.

**What should happen:** Frank gets as much of the service as allowed - 70% of the pods with
duration-based's 30% reserve, 90% with fair share fast lane's 10% - with the reserve left free on purpose in case
fast work arrives.

| | slot-based | duration-based | slot-based fair share | fair share fast lane |
|---|---|---|---|---|
| Frank's job, time to finish | 2h 51m | 3h 46m | 2h 51m | 3h 19m |

Duration-based's 30% reserve makes Frank's job take about a third longer. Fair share fast lane's is 10%, so it
costs about 16%. Production runs slot-based, which has no reserve, so this would be a new cost.

**Question:** is the reserve worth this cost? How often is a slow service used by one user alone?

### 8. One user with many jobs

**The situation:** Ivan has four jobs and Judy has one, each of 150 two-minute work items.

**What should happen:** Ivan and Judy each get about half the service, rather than Ivan getting four
times as much for having submitted four jobs.

| | slot-based | duration-based | slot-based fair share | fair share fast lane |
|---|---|---|---|---|
| Judy's share | 0.40 | 0.40 | 0.98 | 0.94 |
| Fairness | 0.74 | 0.74 | 0.99 | 0.98 |

**Question:** should fairness always be between users, or should some (e.g. operational pipelines)
get more?

### 9. A job that turns slow

**The situation:** Kim's job has 1,200 work items: the first 1,000 take about a minute, the last 200
about 20 minutes. Lee submits a new job of 100 one-minute work items every 15 minutes.

**What should happen:** once Kim's work turns slow, it's noticed within a few work items and limited,
so Lee's jobs keep flowing.

| | slot-based | duration-based | slot-based fair share | fair share fast lane |
|---|---|---|---|---|
| Lee's jobs, times their minimum (average) | 21.8× | 21.8× | 3.5× | 3.7× |
| Lee's jobs, times their minimum (worst) | 43.2× | 43.2× | 6.8× | 8.4× |

Duration-based never notices, because it uses the average over Kim's whole job, which stays low.
Slot-based fair share doesn't need to notice: it holds Kim to a fair share of the pods however
long Kim's work items take.

**Question:** do real jobs change speed part way through like this, e.g. when granule sizes change?

### 10. A larger sync request

**The situation:** as scenario 2, but Bob's sync request has 4 granules - more than production
allows today, as if a service raised its sync limit.

**What should happen:** Bob's request finishes close to 1 minute, without noticeably delaying Alice.

| | slot-based | duration-based | slot-based fair share | fair share fast lane |
|---|---|---|---|---|
| Bob's request, time to finish | 1m 47s | 1m 50s | 1m 24s | 1m 39s |
| Alice's job, time to finish | 1h 05m | 1h 05m | 1h 05m | 1h 05m |

**Question:** are multi-granule sync requests likely enough to keep this scenario?

### 11. Two new slow jobs

**The situation:** Frank and Mia each submit 60 work items of about 30 minutes, at the same time.
Nobody knows yet that their work is slow. Five minutes later, Gina submits 300 one-minute work
items.

**What should happen:** Gina's work starts promptly and keeps flowing, and once Frank's and Mia's
work is known to be slow, the three share the service fairly. Frank and Mia finishing later is the
expected price.

| | slot-based | duration-based | slot-based fair share | fair share fast lane |
|---|---|---|---|---|
| Gina's job, times its minimum | 12.5× | 4.8× | 5.7× | 2.5× |
| Fairness | 0.72 | 0.89 | 0.94 | 0.98 |

**Question:** this puts Gina first. Fair share fast lane could instead give Frank and Mia more as soon as their
work is seen to be slow: Gina's job would take about a quarter longer, and the sharing would be
slightly more even. Which matters more?

### 12. A job with occasional long items

**The situation:** three users start together. Kim has 80 work items of about 30 minutes (slow).
Nora has 400 work items: most take about 2 minutes, but 1 in 20 takes about 20 minutes, so they
average about 3 minutes (fast). Omar has 400 one-minute work items.

**What should happen:** Nora's job is treated as fast: the occasional long work items don't hold up
the rest of it or cost Nora a fair share. Omar's work keeps flowing.

| | slot-based | duration-based | slot-based fair share | fair share fast lane |
|---|---|---|---|---|
| Nora's job, times its minimum | 3.7× | 3.7× | 2.8× | 2.7× |
| Nora's share | 0.74 | 0.80 | 0.92 | 0.92 |
| Omar's job, times its minimum | 9.7× | 9.7× | 3.9× | 3.2× |

**Question:** is "1 in 20 work items takes 10 times as long" a realistic mix? Do some services
have much heavier tails?

### 13. A busy day

**The situation:** over six hours, users submit jobs at random to a chain of two services, a 30 pod
subsetter followed by a 10 pod reformatter:

- **pipeline** - a big job (300-600 granules) every 30 minutes on average
- **analyst** - a medium job (20-200 granules) every 20 minutes
- **student** - a small job (5-60 granules) every 45 minutes, subsetter only
- **modeler** - a slow job (10-40 granules, mostly about 25 minutes each) every 90 minutes
- **viewer** - a 1 granule sync request every 4 minutes

**What should happen:** sync requests stay fast, small jobs aren't stuck behind the pipeline's big
jobs, and the modeler's slow jobs don't take over the subsetter.

Over 3 runs, compared with slot-based, slot-based fair share made jobs 25% quicker on average (the
worst job 34% quicker), sync requests 26% quicker (the slowest 51% quicker), and the sharing 10% more
even. Fair share fast lane did a few percent better on most of these, and slot-based and
duration-based were about the same. The sync requests here wait at two services, so they're slower than the 10 second target
under every policy; this scenario's durations aren't based on production's yet.

**Question:** this is the scenario most worth making realistic. What does a busy day on a real
Harmony service look like - which users, how many jobs, what sizes, how often? Could we build it
from production job history?

### 14. hoss under a backlog

This one is built from the production dashboard's stats for hoss, which uses nearly half of all
of Harmony's pod time. The scenario file (`scenarios/production/hoss-saturated.yml`) says which
parts come from the data and which are assumptions.

**The situation:** two hours on a 125 pod service with more work queued than it can do, as hoss
has (about 200,000 work items ready). Work items take seconds, like hoss's (median 4.7 seconds).
Sixteen users: two big ones; one whose work items average 8.5 minutes, like a real hoss user;
eight mid-sized users submitting 500 granule jobs every 20 minutes or so; three small users; a
sync request about once a minute; and a user who sends single granule requests one at a time,
waiting for each to finish.

**What should happen:** sync requests start within seconds (under 10 seconds of latency), every
user with work waiting gets an equal share of pod time however long their work items take, the
one-at-a-time user's requests each finish quickly, and pods stay busy.

| | slot-based | duration-based | slot-based fair share | fair share fast lane |
|---|---|---|---|---|
| Sync requests, latency (95% within) | 18.9s | 20.3s | 6.2s | 5.9s |
| Sync requests, latency (average) | 7.2s | 7.4s | 2.7s | 2.5s |
| Fairness | 0.23 | 0.23 | 0.86 | 0.93 |
| The 8.5 minute user's share | 6.45 | 6.44 | 1.36 | 1.13 |
| One-at-a-time requests, times their minimum | 3.7× | 3.8× | 2.0× | 1.9× |
| Pods busy | 97.8% | 97.8% | 97.0% | 96.8% |

With slot-based, the user whose work items take 8.5 minutes ends up holding over half of the pods,
as the dashboard's live view of production showed: each scheduling pass gives every user a slice,
other users' pods come back within seconds, and theirs don't. Both candidates hold that user to
about a fair share, which is what brings sync requests under 10 seconds.

**Question:** does this look like hoss on a busy day? How many users are usually active at once,
and how big are their jobs?

### 15. geoloco full with one user

Built from the dashboard's stats for geoloco (`scenarios/production/geoloco-one-user.yml`). That
week one user did all of geoloco's work, keeping about 122 of its 125 pods busy for 36 hours, with
work items of about 2 minutes.

**The situation:** that user keeps all 125 pods busy. Twenty minutes in, a newcomer submits a 300
granule job; small jobs arrive every 15 minutes or so; a sync request comes in about every 5
minutes.

**What should happen:** the newcomer and the small jobs get an equal share of the pods soon after
they arrive (with 125 pods finishing 2 minute work items, one comes free about every second), sync
requests start within seconds, and the service stays busy.

| | slot-based | duration-based | slot-based fair share | fair share fast lane |
|---|---|---|---|---|
| The newcomer's job, times its minimum | 1.59× | 1.58× | 1.51× | 1.51× |
| Small jobs, times their minimum | 1.13× | 1.13× | 1.08× | 1.09× |
| Sync requests, latency (95% within) | 34s | 35s | 30s | 32s |
| Fairness | 0.93 | 0.94 | 0.95 | 0.95 |
| Pods busy | 99.6% | 99.6% | 99.6% | 99.2% |

Every policy does about as well here: with work items this long, pods come free often enough for a
newcomer to get going. No policy gets sync requests under 10 seconds, though. About 15 work items
are already waiting on the service's queue ahead of each new one, so a sync request waits for them
whatever the policy decides next.

**Question:** is one user filling a service common? Would a separate fast path for sync requests,
ahead of work already queued, be worth having?

### 16. A trajectory-subsetter burst

Built from the dashboard's stats for trajectory-subsetter (`scenarios/production/trajectory-burst.yml`),
which is usually lightly used but for hours at a time keeps 100-124 of its 125 pods busy. Its work
items have a heavy tail: median 14 seconds, but 2.4% take over 5 minutes and the longest took 71.

**The situation:** two hours of a burst. Two big users with work items averaging about 2 minutes, a
user with many 10 second work items, three mid-sized users submitting jobs every 15-20 minutes,
two users whose work items average 4-6 minutes, two small users, and a sync request every 2
minutes on average.

**What should happen:** every user with work waiting gets an equal share of pod time however long
their work items take, sync requests start within seconds, and the mid and small users' jobs keep
moving.

| | slot-based | duration-based | slot-based fair share | fair share fast lane |
|---|---|---|---|---|
| Sync requests, latency (95% within) | 22.1s | 25.6s | 12.8s | 9.8s |
| Fairness | 0.66 | 0.66 | 0.91 | 0.96 |
| A mid-sized user's jobs, times their minimum | 7.1× | 7.1× | 4.7× | 5.4× |
| A small user's jobs, times their minimum | 4.2× | 4.2× | 1.5× | 1.3× |
| Pods busy | 99.2% | 99.2% | 98.8% | 98.5% |

**Question:** does this look like a trajectory-subsetter burst - the number of users, their job
sizes?

### 17. A slow user arrives first

Not from one service's stats: it's the case the fast lane reserve exists for, at production's scale
(`scenarios/production/slow-user-first.yml`). Slow work is rare in production, but outliers of 30
minutes to 2 hours happen.

**The situation:** a 125 pod service is idle when a user submits 500 work items that take 30 to 60
minutes - nobody knows yet that they're slow. Five minutes later fast users arrive with work items
of seconds, and sync requests start arriving about once a minute.

**What should happen:** the slow user never holds all of the pods, fast work and sync requests start
within seconds, and once everyone has work waiting the slow user has about a fair share.

| | slot-based | duration-based | slot-based fair share | fair share fast lane |
|---|---|---|---|---|
| Sync requests, latency (95% within) | 26m 57s | 26m 40s | 26m 41s | 7.8s |
| Sync requests, latency (average) | 6m 27s | 5m 22s | 6m 58s | 1.6s |
| Fast jobs, times their minimum | none finished in 2h | 24× | 36× | 6.9× |
| The slow user's share | 3.71 | 2.18 | 2.19 | 1.27 |
| Fairness | 0.24 | 0.55 | 0.51 | 0.81 |

With nobody else waiting when the slow user arrives, slot-based, duration-based and slot-based
fair share all let them take every pod, and Harmony doesn't interrupt running work items, so work
arriving afterwards waits for them to finish - about half an hour. Fair share fast lane runs only 2 work items
of a new job (plus a share of an allowance) until one finishes, and keeps 10% of the pods out of
slow work's reach, so sync requests start within 8 seconds (95% of them). With a 30% reserve, as
duration-based has, it would be about 2 seconds.

**Question:** how often does a user fill an idle service with long work items? Is protecting
against it worth the reserve's cost when slow work has the service to itself (scenario 7)?

## What the scenarios don't cover

- **A service with a backed up queue**, where work items wait on pods before they start.
- **Autoscaling** - pod counts are fixed.
- **Smaller and larger services** - every scenario uses 20 pods (an earlier round also tried 4 and
  80).
- **Failures and retries**, slow work in a chain's second step, and bursts of sync requests (also
  tried in the earlier round).
- **Parts of Harmony the simulator doesn't model:** the CMR query step, aggregation, cancellation,
  timeouts, and several scheduler pods working at once.
- **Real traffic** - every scenario is made up.

**Question:** which of these matter most before trying a new policy in a sandbox or UAT? Are there
real incidents, such as a service taken over by one user, that should become scenarios?

## Appendix: how the results are produced

- **The scenarios are defined in** `tools/fair-queueing-sim/scenarios/stories/*.yml` (1-12),
  `scenarios/mixed-workload.yml` (13) and `scenarios/production/` (14 `hoss-saturated.yml`, 15
  `geoloco-one-user.yml`, 16 `trajectory-burst.yml`, 17 `slow-user-first.yml`). Each file's `description` and `goodOutcome` are the source
  of the situations and goals above, and its `benchmarks` list names the measures shown.
- **The results come from** the committed benchmark records (`benchmarks/results/*.json`), as of
  2026-11-12: 5 runs per scenario (seeds 101-105) for 1-12. Scenarios 13 (3 runs, seeds 101-103)
  and 14-17 (5 runs, seeds 101-105) aren't in the records; their results are from runs made
  between 2026-11-09 and 2026-11-12 of code that makes the same decisions as the records'. Runs
  with the same seed have the same random inputs - work item durations and when jobs are due -
  under every policy. That makes the workloads the same, with one exception: a user who waits for
  each request to finish before sending the next (the one-at-a-time user in 14) sends them at
  times, and so sends as many, as the policy lets them. The commands that regenerate the results
  are below.
- **Details:** how each measure is defined is in [REFERENCE.md](REFERENCE.md#the-metrics); why
  the two candidates work the way they do, and seed-by-seed comparisons, are in
  [POLICY-DESIGN.md](POLICY-DESIGN.md).

To regenerate the results, from `tools/fair-queueing-sim`:

```
# 1-12, from the suite (benchmarks/suite.yml), seeds 101-105
npm run sim -- bench

# 13, seeds 101-103
npm run sim -- bench scenarios/mixed-workload.yml --seeds 101,102,103

# 14-17, seeds 101-105 (the suite's)
npm run sim -- bench scenarios/production/hoss-saturated.yml scenarios/production/geoloco-one-user.yml scenarios/production/trajectory-burst.yml scenarios/production/slow-user-first.yml
```
