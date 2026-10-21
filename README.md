# AI Interview Coach

**Practice real job interviews on your own computer, with an AI coach that scores every answer and shows you how
to sound like an experienced professional.**

The app asks you interview questions out loud, records your answer on camera and microphone, transcribes it, and
gives detailed feedback: a score, what you missed, a model answer in your own voice, your pace and filler words,
whether you sound natural or rehearsed, and how to improve. Upload your resume and it generates the questions an
interviewer would ask *you*, with answers built from your real experience.

It runs entirely on your machine. There is no account, no sign-up and no server of ours. Each person who downloads
it has their own private copy.

---

## Why use it
- **Your questions, your resume, your target job.** Upload a question list, or generate questions from your resume
  and a job description.
- **Honest, specific feedback.** Every answer gets a score out of 10, six sub-scores, mistakes, missing points,
  "you said / say instead", and a full model answer.
- **Sound natural, not memorized.** A tone check flags answers that sound read or recited, and Shadow practice
  trains you to say your answers fluently out loud.
- **Track progress.** Retry a question and see your old score next to your new one, with what improved.
- **Use the AI you like.** OpenAI, Claude, Gemini, Groq, OpenRouter, or a free local model with Ollama.
- **Private by design.** Your videos, answers, resumes and keys never leave your computer, except for the requests
  sent to the AI provider you choose.

## What you need
1. **Python 3.10 or newer.** Download it from [python.org](https://www.python.org/downloads/).
   On Windows, tick **"Add python.exe to PATH"** during install.
2. **Google Chrome or Microsoft Edge**, for the camera, microphone and voices.
3. **An API key** from one of the [supported AI providers](#choose-your-ai-provider), or [Ollama](https://ollama.com)
   for a free local model.

## Install and run

### Option A: download the ZIP (no Git needed)
1. On this page, click the green **Code** button, then **Download ZIP**.
2. Unzip it anywhere, for example your Documents folder.
3. Start the app:
   - **Windows:** double-click `run.bat`.
   - **macOS / Linux:** open a terminal in the folder and run `chmod +x run.sh && ./run.sh`.

### Option B: clone with Git
```bash
git clone https://github.com/sud018/AI_Interview_coach.git
cd AI_Interview_coach
```
Then double-click `run.bat` (Windows) or run `./run.sh` (macOS / Linux).

The first start takes a minute: it creates a private Python environment inside the folder and installs what the app
needs. After that it starts in a few seconds. Your browser opens **http://127.0.0.1:5000** automatically.
Keep the terminal window open while you use the app; close it to stop the app.

## Your first mock interview in 5 minutes
1. **Connect your AI.** On the welcome screen, pick a provider, paste your API key, and click **Test & save**.
2. **Add your resume** (optional, recommended). In the **Resumes** tab, upload a PDF or Word resume.
   It becomes your active resume.
3. **Get questions.** In the **Questions** tab, click **Generate questions** to create questions from your resume,
   or upload or type your own. Paste a job description to tailor everything to that job.
4. **Start the interview.** Choose **Coach mode** (feedback after each answer) or **Real mode** (feedback at the
   end), allow camera and microphone, and answer out loud.
5. **Review.** Read your feedback, listen to the model answer, retry weak questions, and generate a full training
   report with a 7-day plan.

## Choose your AI provider
Scoring, coaching, model answers, lessons and reports work with any of these. Pick one in **Settings**:

| Provider | Get a key at | Example model |
|---|---|---|
| OpenAI | platform.openai.com | `gpt-6-luna`, `gpt-4o-mini` |
| Anthropic (Claude) | console.anthropic.com | `claude-sonnet-5-5` |
| Google Gemini | aistudio.google.com | `gemini-2.5-flash` |
| Groq | console.groq.com | `llama-3.3-70b-versatile` |
| OpenRouter | openrouter.ai | `openai/gpt-4o-mini` |
| Ollama (free, runs locally) | no key needed, install [Ollama](https://ollama.com) | `llama3.1` |
| Any other OpenAI-compatible API | your provider | enter its base URL |

Model names change over time; type the exact name from your provider's model list. Click **Test** in Settings to
check that your key and model work.

**Voice features** use OpenAI's speech models, so they need an OpenAI key. You can add one in Settings while using
another provider for scoring.
- **Speech-to-text** for spoken answers. Groq users get this through Groq's Whisper with no OpenAI key needed.
- **Natural read-aloud voice** in Shadow practice. Without it, the free browser voice is used.
- **"AI listens"** analysis of how your voice sounds.

Without speech-to-text you can still type your answers.

## Resumes
Upload one or more resumes in the **Resumes** tab (PDF, Word .docx or TXT, or paste the text). Each is saved in the
`resumes/` folder on your computer. Click **Make active** on the one you want to use:
- **Questions -> Generate from your resume** writes questions about your real projects and skills. Choose how many
  and the focus (mixed, project deep-dives, technical or behavioral), optionally with model answers.
- Scoring, model answers and Learn lessons use your active resume, and never invent employers or numbers that
  aren't in it.
- **Shadow practice** answers are written from it, and **+ New set** can build a whole practice set from it.

Keep several resumes, for example one per job type, and switch between them any time. Click **View text** to see what
the AI reads. Scanned-image PDFs can't be read, so upload a Word file or paste the text instead.

## All features
- **Questions:** upload Excel / CSV / PDF / Word / TXT, type them, or generate them from your resume. Excel and CSV
  files can have `Question`, `Answer` and `Category` columns (see `sample_questions.csv`). Save lists as question sets.
- **Learn:** click **Learn** on any question for a full lesson: what the interviewer is testing, the concept from
  zero, key terms, answer structure, a model answer, common mistakes and likely follow-ups.
- **Job description (optional):** paste one above *Start interview* to tailor scoring, answers and lessons.
- **Two interview modes:** Coach mode gives feedback after each answer, with Retry. Real mode runs the questions
  back-to-back with feedback at the end.
- **Per-answer feedback:** score /10 with 6 sub-scores, transcript, pace and filler words, strengths, improvements,
  missing points, mistakes, model answer (with Listen), answer structure, technical terms, "you said / say instead",
  body language from webcam snapshots (if your model can read images), follow-up questions and a practice drill.
- **Tone check:** rates whether you sound natural or rehearsed, with the evidence and how to fix it.
- **Retry comparison:** see old score -> new score, what improved, and what still needs work.
- **Training report:** strengths, weaknesses, vocabulary, topics to study, a 7-day plan and a phrase bank, also
  saved as `report.md`.
- **History:** reopen past interviews, replay your videos, and practice any question again.

### Shadow practice (voice only)
Rehearse answers out loud until they flow. Pick a question, choose an **American** or **Indian** accent, and press
**Start shadowing**.
- **Speak along:** the voice plays the whole answer while you speak with it (wear headphones).
- **Listen, then repeat:** hear one phrase, repeat it, and get a 0-100 score for word accuracy, pace and hesitations.
- Finish with a summary, your problem words, pronunciation tips, and **Say it from memory**.

## Privacy: every user is isolated
- Each person runs their own copy of the app on their own computer. Nothing is shared between users, and there is no
  central server or account.
- Everything you create stays inside your copy of the folder:

  | Folder | Contents |
  |---|---|
  | `data/settings.json` | your API keys and settings (plain text, so don't share this folder) |
  | `sessions/` | interview videos, audio, webcam snapshots, transcripts, feedback and reports |
  | `resumes/` | your uploaded resumes |
  | `data/` | your question sets and practice progress |
  | `shadow_recordings/` | your Shadow practice recordings |

- These folders are listed in `.gitignore`, so they are never uploaded to GitHub, even if you fork this project.
- The app only listens on `127.0.0.1`, so other devices on your network can't open it.
- Your answers, transcripts, resume text and webcam snapshots are sent only to the AI provider you configure, under
  that provider's terms. With Ollama, nothing leaves your computer at all.

## Updating
- **Git:** run `git pull` in the folder. Your data folders are untouched.
- **ZIP:** download the new ZIP and copy your `data`, `sessions`, `resumes` and `shadow_recordings` folders into it.

## Troubleshooting
| Problem | Fix |
|---|---|
| "Python is not installed" | Install Python 3.10+ and tick "Add python.exe to PATH", then run again. |
| Camera or microphone not working | Use Chrome or Edge, click the camera icon in the address bar and allow access. |
| `./run.sh: Permission denied` | Run `chmod +x run.sh` once. |
| Port 5000 is already in use | Windows: `set PORT=5050` then `run.bat`. macOS/Linux: `PORT=5050 ./run.sh`. |
| "Test failed" in Settings | Check the key, the model name, and that your provider account has credit. |
| Resume text looks empty or garbled | It's probably a scanned PDF. Upload the Word file or paste the text. |
| Body-language analysis errors | Pick a model that can read images, or untick it in Settings. |

## Costs
The app is free. AI usage is billed by your provider at their rates; with a small model, scoring one answer usually
costs about a cent or less. Ollama is completely free.

## License
MIT - free to use, modify and share. See [LICENSE](LICENSE).
