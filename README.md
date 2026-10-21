# AI Interviewer

Practice job interviews with your own questions, on your own computer. The app asks each question (read aloud),
records your answer on camera and microphone, transcribes it, scores it, and coaches you to answer like an
experienced professional. A voice-only **Shadow practice** mode helps you rehearse answers out loud until they
sound natural.

Everything runs locally. Your recordings, transcripts, history and API keys stay in this folder on your computer.
Nothing is sent anywhere except the AI provider you choose.

## Requirements
- Python 3.10 or newer ([download](https://www.python.org/downloads/); on Windows tick **"Add python.exe to PATH"**)
- Chrome or Edge (for camera, microphone and voices)
- An API key from one of the supported AI providers (see below)

## Quick start
```bash
git clone <this-repo-url>
cd ai-interviewer
```
- **Windows:** double-click `run.bat`
- **macOS / Linux:** run `./run.sh`

The first run creates a virtual environment and installs the packages, then the app opens at
http://127.0.0.1:5000. Pick your AI provider, paste your key, and allow camera/microphone when the browser asks.

## AI providers
Scoring, coaching, model answers, lessons and reports work with any of these:

| Provider | Key from | Example model |
|---|---|---|
| OpenAI | platform.openai.com | `gpt-6-luna`, `gpt-4o-mini` |
| Anthropic (Claude) | console.anthropic.com | `claude-sonnet-5-5` |
| Google Gemini | aistudio.google.com | `gemini-2.5-flash` |
| Groq | console.groq.com | `llama-3.3-70b-versatile` |
| OpenRouter | openrouter.ai | `openai/gpt-4o-mini` |
| Ollama (free, local) | no key needed - install [Ollama](https://ollama.com) | `llama3.1` |
| Any other OpenAI-compatible API | your provider | enter its base URL |

Model names change over time; check your provider's model list and type the exact name in Settings.
Use **Test** in Settings to check that the key and model work.

**Voice features** use OpenAI speech models, so they need an OpenAI API key (you can add one alongside another
provider in Settings):
- Speech-to-text for spoken answers. *Groq users get this through Groq's Whisper, no OpenAI key needed.*
- The natural read-aloud voice in Shadow practice. Without it, the free browser voice is used.
- "AI listens" delivery analysis.

Without any speech-to-text you can still type your answers.

## Resumes
Open the **Resumes** tab to upload one or more resumes (PDF, Word or TXT, or paste the text). Each one is saved on
your computer in the `resumes/` folder. Pick one and click **Make active**:
- **Questions tab -> Generate from your resume** writes interview questions about your real projects and skills
  (choose how many and the focus: mixed, project deep-dives, technical or behavioral), optionally with model answers.
- Scoring, model answers and Learn lessons use your active resume, and never invent employers or metrics that
  aren't in it.
- **Shadow practice** answers are written from the active resume, and **+ New set** can generate a whole practice set
  from it.

Switch the active resume at any time, for example one per job type. Use **View text** to check what the AI reads;
scanned-image PDFs can't be read, so upload a Word file or paste the text instead.

## Features
- **Questions:** upload Excel / CSV / PDF / Word / TXT, or type them. Excel/CSV can have `Question`, `Answer`,
  `Category` columns (see `sample_questions.csv`). Tick "Use AI to extract" for messy PDFs/Word files. Save lists
  as question sets. Click **Learn** on any question for an A-Z lesson.
- **Job description (optional):** paste a JD above *Start interview* to tailor scoring, model answers and lessons.
- **Interview modes:** Coach mode gives feedback after each answer (with Retry); Real mode runs back-to-back with
  feedback at the end.
- **Per-answer feedback:** score /10 with 6 sub-scores, transcript, pace and filler words, strengths, improvements,
  missing points, mistakes, model answer, answer structure, technical terms, "you said / say instead",
  body language (from webcam snapshots, if your model can read images), follow-up questions and a practice drill.
- **Tone check:** rates whether you sound natural or rehearsed, with evidence and tips.
- **Retry comparison:** answering the same question again shows old score -> new score and what improved.
- **Training report:** strengths, weaknesses, vocabulary, topics to study, a 7-day plan and a phrase bank
  (also saved as `report.md`).
- **History:** reopen past interviews, replay videos, practice a question again.

## Shadow practice (voice only)
Pick a question, choose an **American** or **Indian** accent, and press **Start shadowing**.
- **Speak along:** the voice plays the whole answer while you speak with it (wear headphones).
- **Listen, then repeat:** hear one phrase, repeat it, get scored 0-100 on word accuracy, pace and hesitations.
- At the end: summary, problem words, pronunciation tips, and **Say it from memory**.
- A small sample set is included. Click **+ New set** to upload your own questions, or tick **Generate questions and
  answers from the resume**. **Generate missing answers** writes first-person answers from your active resume.

## Privacy and where data is saved
All of this stays in the app folder on your computer and is excluded from git by `.gitignore`:
- `data/settings.json` - your API keys and settings (plain text; don't share this folder)
- `sessions/<date>_<name>/` - videos, audio, webcam frames, transcripts, evaluations, reports
- `data/question_sets/`, `data/shadow_sets/`, `data/shadow_progress/` - your question lists and practice progress
- `shadow_recordings/` - your Shadow practice recordings
- `resumes/` - your uploaded resumes (original file + extracted text)

Your answers, transcripts and webcam frames are sent to the AI provider you configure, under that provider's terms.
The server only listens on `127.0.0.1`, so other devices on your network can't open it.

## Costs
API usage is billed by your provider. With a small model, scoring one answer typically costs about a cent or less.

## License
MIT - see `LICENSE`.
