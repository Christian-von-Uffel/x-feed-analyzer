# Coordinated Posting on a Topic: Tested on Real Cases

Validation run, 22 Sep 2026. It tests the ideas in [pushed-or-organic.md](pushed-or-organic.md) on real posts, using `coord.js`. That module is built and tested but not yet wired into the viewer. Every number here can be reproduced with [validation/](validation/).

- **The three proven pushes each had a different signature:**
  - #KochFarms: copied templates;
  - #PhosphorusDisaster: the same question put to 27 officials and reporters;
  - #EbolaInAtlanta: one account writing 61% of the posts.

  So a detector built around one of them would miss the others.
- **What caught all three was concentration: a few accounts posting many times within an hour.** The pushes had 105, 10 and 3 such accounts; the organic topics had at most 2. #EbolaInAtlanta only just met the line.
- **Accounts that co-act again and again were the most precise signal.** They caught the two copying pushes and no organic topic. The organic data is a roughly 2% sample, so neither result yet proves a low false-alarm rate on X.
- **The one-minute rule finds automation, not people working from a script.** Only 6 of the 306 #KochFarms template groups had copies within a minute of each other. Most were 1 to 60 minutes apart.
- **In ordinary Twitter, three or more accounts posting the same text within a minute was nearly always coordination of some kind.** Of 97 such groups:
  - 57 were spam or fake-persona networks;
  - 21 were several accounts with one owner;
  - 6 were activists or fans;
  - 2 were a shared headline;
  - 4 were independent coincidences;
  - 7 were unclear.
- **Clusters of three or more accounts that co-acted on two or more different posts: 31 among 660,000 accounts.** 30 were coordination or automation. 7 of those were open about it (fans, live-stream chat apps, one owner's accounts).
- **Two ideas from the research review failed and are dropped.**
  - Timing measured against reshuffled post times scored organic news *above* the pushes.
  - How fast accounts arrive scored the Farrah Fawcett news (71%) like the pushes (75–82%).
- **Capture has to be dense.** A push showed up only when the capture held at least 20 of its posts and roughly 10–25% of its burst. Scrolling a home timeline will not get there; a Latest-tab sweep has to.

## The data

| Set | What it is | Used for | Limits |
| --- | --- | --- | --- |
| [IRA tweets](https://github.com/fivethirtyeight/russian-troll-tweets) (FiveThirtyEight, Clemson) | 2.97M tweets from the Internet Research Agency handles Twitter gave Congress. Complete for those accounts, with exact times from the tweet ids. | Three fabricated stories: **#KochFarms** (poisoned Thanksgiving turkeys, 26–27 Nov 2015), **#PhosphorusDisaster** (poisoned water in Idaho, 10 Mar 2015) and **#EbolaInAtlanta** (an invented patient, 13–14 Dec 2014). | Campaign posts only. The real users who reacted are not in it. |
| [Sentiment140](https://cs.stanford.edu/people/alecmgo/trainingandtestdata.zip) (Go et al. 2009) | 1.6M tweets from 660,000 ordinary accounts, Apr–Jun 2009. | Seven organic topics, and the whole set as a background of ordinary posting. | About 1 in 45 of all tweets (from the gaps between its sequential ids), only tweets with emoticons, retweets removed. At this density two posts that match rarely both survive, so organic pair counts are floors. |

Reposts are left out of every measure. In a capture a repost shows as the original author's post, and X does not show when the repost happened. The organic side at full density is **untested**: that would have needed your catalogue or a live Bluesky recording, and both were declined for this run.

## The method, step by step

### 1. Define the case

A case is:

- a pattern for the topic;
- the words and hashtags that define it, which every post shares and which are ignored when comparing texts;
- a window around the spike.

Example: `koch ?farm|#?food ?poisoning`, ignoring *kochfarms, foodpoisoning, koch, farms, food, poisoning*, from 20 Nov to 6 Dec 2015.

### 2. Capture the burst densely

**What was tested.** Each push was captured at random at shares from 100% down to 2.2%, 40 times per share. For each share, the table gives how often at least one of the four lines in step 3 to 5 was crossed. A capture with fewer than 20 posts is treated as saying nothing.

| Capture share | #KochFarms (3,430 posts) | #PhosphorusDisaster (667) | #EbolaInAtlanta (95) |
| --- | --- | --- | --- |
| 100% | 1.00 | 1.00 | 1.00 |
| 50% | 1.00 | 1.00 | 1.00 |
| 25% | 1.00 | 1.00 | 0.88 |
| 10% | 1.00 | 1.00 | 0 (under 20 posts) |
| 5% | 1.00 | 0.75 | 0 |
| 2.2% | 0.17 | 0.07 | 0 |

**Verdict.** Useful, with a floor. The capture has to hold at least 20 posts and about 10–25% of the burst. Small pushes need more. A home-timeline scroll captures far less than 2% of a topic, so the sweep in the origin-tracing proposal is required, not optional.

### 3. See who produced the burst

**What it measures.**

- **Heavy posters:** accounts with 5 or more posts on the topic inside one hour.
- **Posts per account.**
- **The top account's share** of the topic.

**Real examples.**

- **#KochFarms.** 105 of 122 accounts were heavy posters, and they wrote 99% of the posts. The median gap between one account's posts was 41 seconds. 57% of all posts fell in one hour, 00:00–01:00 UTC on 27 Nov.
- **#PhosphorusDisaster.** 11 accounts wrote 667 posts in under four hours, 60 each.
- **#EbolaInAtlanta.** One account (JASPER_FLY) wrote 58 of the 95 posts.

**Organic topics.** At most 2 heavy posters. Posts per account ranged from 1.00 to 1.20. The top account never had more than 1.6%.

**Verdict.** This is the only family of measures that caught all three pushes. The caveat is density. At full capture, organic topics will have live-tweeters and news accounts posting many times. The organic maxima above come from a 2% sample, so they are floors, not calibrated thresholds.

### 4. Find copies, and read their timing

**What it measures.** Copies and light edits across accounts. The method is MinHash on three-word shingles, confirmed by overlap. A post needs six words, three of them content words, so a greeting cannot link strangers. The copy share is the share of posts that copy another account. Each copy group also gets a timing band: the median gap between a copy and the nearest copy by another account.

**Real examples.**

- **#KochFarms: 96% of posts were copies of another account's post.** One template, "These people deserved it. #vegan #KochFarms #FSIS", came from 29 accounts. The variants added trending hashtags such as #DogThanking and #ImThankfulFor.
- **#PhosphorusDisaster: 20%.**
- **#EbolaInAtlanta: 6.5%.** Its posts were personalised with a salutation, as in "Mr Kirk!".
- **Organic topics: 0.7% to 6.9%.**

A spot check of 12 random matched pairs from #KochFarms found 12 real copies.

**Timing.** In the pushes, copies from different accounts were minutes apart:

| Copy groups of 3+ accounts | Within 1 min | 1–10 min | 10–60 min | Longer |
| --- | --- | --- | --- | --- |
| #KochFarms | 6 | 163 | 124 | 13 |
| #PhosphorusDisaster | 0 | 1 | 6 | 0 |
| Sentiment140, all 1.6M posts | 97 | 67 | 75 | 771 |

The 97 Sentiment140 groups within a minute were labelled by reading their handles, texts and links:

| Label | Groups | Example |
| --- | --- | --- |
| Spam or fake-persona network | 57 | "Get 100 followers a day using …" from numbered handles; filler text from elisabeth_l1 … l7 |
| One owner's several accounts | 21 | a weather service's city accounts; a jobs board's feeds |
| Activists, fans, chain messages | 6 | Iran election solidarity posts, Air France condolence chain, #KEVINJONAS |
| Shared headline | 2 | "Walter Cronkite reportedly gravely ill" |
| Independent people, same moment | 4 | "Watching Jay Leno's last show" |
| Unclear | 7 | |

At 10 to 60 minutes, organic copy groups were mostly different in kind. They included Mother's Day greetings, "Retweet for a chance to win" contests, and fans saying good morning to a celebrity.

**Verdict.**

- **Copy share is useful but not enough.** Jakesch's 20% line caught one push of three (#PhosphorusDisaster sits at 19.9%).
- **Report three windows side by side.** One minute finds automation. Ten minutes to an hour is where human-run pushes sit, but ordinary people show up there too. So a copy inside that band needs step 5.

### 5. Keep the accounts that co-act again and again

**What it measures.** Two accounts co-act when they post:

- the same copied text;
- the same link (with a path, see below);
- the same set of two or more hashtags.

A pair **repeats** when both accounts did this with two or more different posts. Repeat pairs join into clusters, which form the roster.

**Real examples.**

- **#KochFarms:** 87% of accounts were in repeat pairs within an hour, in one cluster of 93 accounts.
- **#PhosphorusDisaster:** 91%, one cluster of 10.
- **#EbolaInAtlanta:** none, because its accounts did not copy each other.
- **Organic topics:** 0%, except one pair in the Iran topic.

Across all of Sentiment140 there were 754 repeat pairs within an hour, covering 304 of 660,000 accounts. 31 clusters had 3 or more accounts:

| Label | Clusters |
| --- | --- |
| Spam or fake-persona network | 21 |
| Open fan campaigns (#chuckmemondays, #mcflyforgermany, #seb-day, #marsiscoming) | 4 |
| Live-stream chat apps that post each message with the stream link | 3 |
| One owner's several accounts | 2 |
| Unclear | 1 |

**Look-alike handles.** Numbered handles (tweeteradder1 … 12, tweetfollow3 … 7) are a cheap extra cue:

- 34 of the 97 one-minute copy groups had them, against 16 of 474 groups spread over more than a day;
- 6 of the 31 repeat clusters had them.

The IRA personas did not (martines_tweets, pruitt_li, tammy_tamh), so their absence proves nothing.

**Verdict.** This is the most precise signal tested, for clusters of three or more accounts. Two-account pairs are weak: in a random sample of them, about a third looked like ordinary people.

**Three fixes came out of testing this step:**

- **One copied post counts once.** Eight fans copied one gossip-site post about Farrah Fawcett, with its bit.ly link. The text and the link counted as two traces and made them a "cluster". Now a repeat needs different posts on both sides.
- **Credited copies are open sharing.** Posts with "via @x", "RT @x" or "(@x)" are kept out of co-action. That removed the Iran relays and some of the Farrah copies.
- **A bare domain is not a shared link.** A Singapore client appended "tweet.sg" to every post, which joined strangers. On X, a link card is captured as its domain alone, so the same mistake would join everyone who shared any article from one site.

### 6. Check copies aimed at people

**What it measures.**

- **Templated:** one copied text addressed to three or more different accounts.
- **Swarmed:** one account receiving copies from three or more accounts.

**Real examples.**

- **#PhosphorusDisaster:** 9 templated questions reached 27 targets, including senators, Idaho reporters and a hospital. "@SenAngusKing should we be afraid of the water contamination with phosphorus?" is one of them. The posts also linked to spoofed outlets at fox-news.ga, abc-news.ga and cnn-news.ga.
- **#KochFarms:** 76 swarmed targets, among them New York health accounts, USDA offices and doctors.
- **#EbolaInAtlanta:** no copies, but 23 journalists and senators were addressed by name, and every post named the invented patient "Yatta Quirre".
- **Organic topics:** #FollowFriday lists produced 4 templated groups, which is a ritual. The MTV awards produced one swarm.

**Verdict.** Useful supporting evidence, and it shows *whom* a push was aimed at. It also flags rituals, so it is not a line to cross.

### 7. Read the evidence and label it

The roster says which accounts acted together. It does not say who ran them.

- 7 of the 31 organic clusters and 29 of the 97 one-minute groups were open coordination.
- The IRA accounts reposted each other: 99% of #KochFarms reposts were of another campaign account's post.
- Keep the vocabulary from the research review: *coordination evidence*, *earliest captured*. Never *bot*, *paid* or *origin*.

## All cases

Four lines are used in the density table:

- 3 or more heavy posters;
- a top account with 25% or more of the posts;
- copies making up 20% or more;
- a repeat cluster of 3 or more accounts.

| Case | Kind | Posts | Accounts | Heavy posters | Top account | Copies | Repeat accounts, 1 h | Aimed copies | Lines crossed |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| #KochFarms | push | 3,430 | 122 | 105 | 2.1% | 96.3% | 87% (93) | 76 swarmed | 3 |
| #PhosphorusDisaster | push | 667 | 11 | 10 | 19.9% | 19.9% | 91% (10) | 9 templated, 27 targets | 2 |
| #EbolaInAtlanta | push | 95 | 8 | 3 | 61.1% | 6.5% | 0% | none | 2 |
| Air France 447 | news | 857 | 806 | 1 | 1.6% | 4.1% | 0% | none | 0 |
| Farrah Fawcett | news | 492 | 485 | 0 | 0.4% | 4.3% | 0% | none | 0 |
| David Carradine | news | 225 | 225 | 0 | 0.4% | 1.4% | 0% | none | 0 |
| MTV Movie Awards | scheduled | 1,661 | 1,593 | 0 | 0.3% | 1.8% | 0% | 1 swarmed | 0 |
| Iran election | news, activism | 1,133 | 989 | 1 | 0.6% | 6.9% | 0.2% (2) | none | 0 |
| #squarespace | contest | 888 | 741 | 0 | 0.8% | 0.7% | 0% | none | 0 |
| #FollowFriday | ritual | 1,031 | 889 | 2 | 0.9% | 1.7% | 0% | 4 templated, 21 targets | 0 |

## What failed

- **Timing against reshuffled times.** Post times were permuted within each hour, which keeps the volume curve, and the co-action rate was compared with the real one.
  - The pushes matched their reshuffle: #KochFarms scored 52.2% within a minute against 52.8% reshuffled. Inside a burst, any two posts are close by chance.
  - Organic news came out *above* its reshuffle (Air France 1.2% against 0.4%; Iran 2.1% against 0.7%), because shared headlines cluster within minutes.
  - Dropped.
- **Onset speed**, the share of accounts that first posted within the busiest 30 minutes. It was 75–82% for the pushes, but 71% for Farrah Fawcett's death. This matches Varol et al.: sudden news looks like a push. Dropped.
- **The one-minute window on its own.** It caught 6 of 306 #KochFarms groups. Kept, but only beside the 10-minute and one-hour windows.
- **Shared links as a lead signal.** Links were on 74% of #KochFarms posts (903 to en.wikipedia.org, 689 to a cooking forum) but on 2.5% and 8.4% of the other two. On X we also store links as displayed, and a link card as its domain only. Co-link needs the full URL; storing the card's link and title is a capture change to test, not a result.

## Features this supports

| Feature | What it shows | Evidence | Status |
| --- | --- | --- | --- |
| **Case scorecard** (`XPCCoord.report`) | For a pattern and dates: heavy posters, top account, copy share, repeat clusters, aimed copies, each next to its line and the sample size. A warning when fewer than 20 posts or a thin burst are captured. | Steps 2–6: all three pushes cross at least two lines; no organic topic crosses any | Module and tests built; not wired |
| **Burst strip** | Hourly counts for the case, with heavy posters' posts marked | #KochFarms: 57% in one hour, 99% by heavy posters | To build |
| **Copy groups** | Each template with its accounts, timing band (1 min, 10 min, 1 h, longer) and credited copies set apart; click for the posts | Step 4, and the credit fix | To build (the "echoes" idea in the copypasta proposal) |
| **Repeat roster** | Clusters of 3+ accounts as a *co-acted* edge on the network map, with look-alike handles flagged | Step 5: 30 of 31 organic clusters were coordination or automation | To build; ask before any table on the map |
| **Aimed copies** | The accounts a template was put to, or that were swarmed | Step 6 | To build |
| **Sweep coverage** | Posts captured per hour of the burst, against the 20-post and 10–25% floor | Step 2 | To build; pairs with the onset sweep |

Not planned: a single "coordination score", the reshuffle baseline, and an onset-speed score.

## What is still untested

1. **False alarms at full capture on X.** The organic side here is a 2% sample of 2009 Twitter. The smallest test: sweep one organic spike on the Latest tab for three hours (gas prices, or a sports final) and read what the scorecard flags.
2. **A capture that mixes campaign and organic posts.** Does the roster pick out the campaign accounts from the real people who joined? Your AI-group event gives a known roster and send time; asking half to paste and half to reword also tests paraphrase.
3. **AI paraphrase.** All three pushes are copy-paste. A reworded push would slip past the copy matcher; the repeat roster could still catch it through links and hashtags, but that has not been shown.
4. **Links as X displays them.** See "What failed".

## Reproduce

[validation/extract.py](validation/extract.py) downloads both sets, about 1.2 GB, into a folder of your choice. It writes each case in the catalogue's post shape. [validation/validate.js](validation/validate.js) prints:

- every scorecard;
- the density table;
- the Sentiment140 copy groups and repeat clusters, so the labels above can be checked or redone.

Density trials use a fixed seed. The labels are one reader's judgement from handles, texts and links, not ground truth.

## Sources

- Linvill & Warren 2020, [Troll factories](https://www.tandfonline.com/doi/abs/10.1080/10584609.2020.1718257), *Political Communication*; the [dataset release](https://github.com/fivethirtyeight/russian-troll-tweets)
- Go, Bhayani & Huang 2009, [Twitter sentiment classification using distant supervision](https://www-cs.stanford.edu/people/alecmgo/papers/TwitterDistantSupervision09.pdf) (Sentiment140)
- Keller et al. 2020; Schoch et al. 2022; Pacheco et al. 2021; Jakesch et al. 2021; Leskovec et al. 2009; Varol et al. 2017; Pote et al. 2025: see [pushed-or-organic.md](pushed-or-organic.md#sources)
