# 📸 Google Photos Takeout Helper (TypeScript Edition)

> A fast, production-grade Node.js / TypeScript command-line tool to clean, deduplicate, date-tag, and organize chaotic Google Photos Takeout exports.

---

## 🌟 Key Features

* **⚡ Interactive & CLI Modes**: Easy step-by-step interactive wizard in terminal, plus full automated CLI flag support for scripting.
* **🔍 Fix Mismatched Extensions**: Automatically inspects magic bytes (via `file-type`) to correct wrong extensions (e.g. `.heic` files that are actually `.jpg`).
* **👯 Smart Deduplication**: Streaming cryptographic hashing (SHA-256) merges exact duplicate files across album folders while preserving album tags.
* **🍏 Live Photo Pairing**: Detects Apple Live Photos & Google Motion Photos, pairing image files (`.HEIC`/`.JPG`) with their paired `.MOV`/`.MP4` video clips.
* **📅 4-Tier Date Recovery**: Fallback date extraction hierarchy:
  1. **Google JSON Sidecar** (`photoTakenTime` / `creationTime`)
  2. **EXIF Header** (`DateTimeOriginal` / `CreateDate`)
  3. **Filename Timestamp** (Regex parsing for WhatsApp, Screenshots, Pixel `PXL_`, etc.)
  4. **Takeout Year Folder** (`Photos from 2023`)
* **📁 5 Album Organization Strategies**:
  * `shortcut` *(Recommended)*: Moves real files to `ALL_PHOTOS/`, creates symlinks/hardlinks in `Albums/<Name>/`.
  * `duplicate-copy`: Copies physical duplicate files into album directories.
  * `json`: Moves files into `ALL_PHOTOS/` and generates an `albums.json` playlist file.
  * `reverse-shortcut`: Places real files inside album directories and creates shortcuts in `ALL_PHOTOS/`.
  * `raw`: Flat chronological directory structure without creating album folders.
* **📍 Metadata & EXIF Restorer**: Writes dates, GPS coordinates, and captions directly into file EXIF headers using `exiftool-vendored`.
* **⏰ OS Timestamp Sync**: Updates file creation (`btime`) and modification (`mtime`) times on Windows and POSIX systems.
* **🛡️ Crash Recovery & Resumability**: Saves progress atomically to `progress.json`, allowing instant resume if interrupted.

---

## 📁 Project Structure

```
Google Take extension project/
├── package.json               # Node.js dependencies & scripts
├── tsconfig.json              # TypeScript configuration (ES2022 / NodeNext)
├── README.md                  # Complete documentation
├── src/
│   ├── bin/
│   │   └── index.ts           # CLI entry point (Commander + Interactive Prompts)
│   ├── core/
│   │   ├── config.ts          # ProcessingConfig interface, options, path sanitization
│   │   ├── context.ts         # Central pipeline state container
│   │   ├── pipeline.ts        # Sequential Pipeline Orchestrator (Steps 1 to 8)
│   │   └── progress.ts        # Atomic progress recording & crash recovery
│   ├── models/
│   │   ├── media-entity.ts    # MediaEntity, FileEntity, AlbumEntity domain models
│   │   └── date-accuracy.ts   # Timestamp confidence tiers (JSON > EXIF > Filename > Year)
│   ├── services/
│   │   ├── exif.service.ts    # Background ExifTool daemon wrapper
│   │   ├── hash.service.ts    # Streaming SHA-256 content deduplication
│   │   ├── mime.service.ts    # Magic byte format verification
│   │   ├── json-matcher.service.ts # Sidecar discovery & truncated filename matcher
│   │   └── concurrency.service.ts  # Concurrency queue manager (p-limit)
│   └── steps/
│       ├── base-step.ts       # Abstract ProcessingStep class & StepResult model
│       ├── step-01-fix-extensions.ts
│       ├── step-02-discover-media.ts
│       ├── step-03-deduplicate.ts
│       ├── step-04-extract-dates.ts
│       ├── step-05-find-albums.ts
│       ├── step-06-move-files.ts
│       ├── step-07-write-exif.ts
│       └── step-08-update-creation-time.ts
└── test/
    └── e2e-test.ts            # Integration test suite with mock Takeout data
```

---

## 🚀 Getting Started

### Prerequisites
* **Node.js**: `v20.0.0` or higher
* **npm**: `v10.0.0` or higher

### Installation

1. Open **Command Prompt (`cmd`)** or **Terminal**.
2. Navigate to the project directory:
   ```cmd
   cd "d:\PROJECTS\GoogleTakeoutExtension\Google Take extension project"
   ```
3. Install dependencies:
   ```cmd
   npm install
   ```
4. Build TypeScript code:
   ```cmd
   npm run build
   ```

---

## 📖 How to Run

### Method 1: Interactive Terminal Wizard (Easiest)

Run the wizard to select folders and preferences step-by-step:

```cmd
npm start
```

#### What happens during the wizard:
1. **Input Path**: Enter (or drag and drop) your unzipped Google Takeout folder path.
2. **Output Path**: Enter where you want your organized library saved.
3. **Album Strategy**: Choose `shortcut`, `duplicate-copy`, `json`, `reverse-shortcut`, or `raw`.
4. **Date Folders**: Choose `none`, `year`, `year-month`, or `day`.
5. **EXIF Writing**: Choose whether to embed dates and GPS coordinates into file headers.

---

### Method 2: Command Line Flags (Automated)

Run directly with CLI arguments:

```cmd
npx tsx src/bin/index.ts -i "D:\Downloads\Takeout\Google Photos" -o "D:\OrganizedPhotos" -a shortcut -d year-month
```

#### Available Options:
| Flag | Short | Description | Default |
| :--- | :---: | :--- | :--- |
| `--input <path>` | `-i` | Path to unzipped Google Takeout input directory | *Required* |
| `--output <path>` | `-o` | Destination directory for organized library | *Required* |
| `--album-behavior <mode>` | `-a` | Album strategy (`shortcut`, `duplicate-copy`, `json`, `reverse-shortcut`, `raw`) | `shortcut` |
| `--date-division <level>` | `-d` | Date hierarchy (`none`, `year`, `year-month`, `day`) | `none` |
| `--no-exif` | | Disable writing recovered dates and GPS to EXIF headers | `false` |
| `--no-fix-extensions` | | Disable magic byte extension repair | `false` |
| `--hardlink` | | Use Windows hard links instead of symlinks | `false` |
| `--no-resume` | | Ignore previous `progress.json` and force fresh run | `false` |
| `--dry-run` | | Simulate pipeline without writing or moving files | `false` |

---

### Method 3: Register `gpth` Globally on Windows CMD

To run `gpth` from **any folder** in CMD:

1. Open CMD inside the project directory and run:
   ```cmd
   npm link
   ```
2. Now, you can open CMD anywhere and run:
   ```cmd
   gpth
   ```

---

## ⚙️ The 8 Processing Steps

```
[Takeout Folder] 
       │
       ▼
 1. Fix Extensions      --> Magic byte MIME repair
       │
       ▼
 2. Discover Media      --> Detects year folders, special folders, pairs JSON sidecars
       │
       ▼
 3. Deduplicate         --> Hashes media, merges duplicate copies, pairs Live Photos
       │
       ▼
 4. Extract Dates       --> 4-tier fallback: JSON -> EXIF -> Filename -> Folder Year
       │
       ▼
 5. Find Albums         --> Sanitizes Unicode & legal filesystem characters
       │
       ▼
 6. Move & Organize     --> Distributes files into ALL_PHOTOS and Album shortcuts
       │
       ▼
 7. Write EXIF          --> Writes EXIF timestamps, GPS coordinates, descriptions
       │
       ▼
 8. Sync OS Timestamps  --> Synchronizes file creation & modification times (btime/mtime)
       │
       ▼
[Clean Photo Library]
```

---

## 🧪 Testing

Run the built-in end-to-end integration test suite to verify pipeline functionality with mock Takeout data:

```cmd
npx tsx test/e2e-test.ts
```

---

## 💡 Troubleshooting & Windows Tips

* **Unzipping Takeout**: If Google Takeout gives you multiple `.zip` files (e.g. `takeout-001.zip`, `takeout-002.zip`), extract **all of them into the same folder** before running this tool.
* **Drag and Drop Paths**: You can drag and drop folders directly into CMD when prompted. The tool automatically removes any surrounding quotation marks (`"`).
* **Windows Symlinks vs Hardlinks**:
  * Symlinks (`shortcut` mode) work across different drives.
  * Hardlinks (`--hardlink`) require the output folder to be on the **same drive** as the temporary target folder on NTFS.

---

## 📄 License

Distributed under the **MIT License**.

# @exe_kartikk