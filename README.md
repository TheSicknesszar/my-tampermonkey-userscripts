# Arena.ai Lightbox Image Download - Tampermonkey Script

## 📦 **Powerful Image Lightbox & Batch Downloader for Arena.ai & Lmarena.ai**

A feature-rich userscript that transforms your browsing experience on AI chat platforms by enabling a professional lightbox with original/edited image detection, EXIF metadata extraction, zoom controls, and a robust batch download system with visual progress tracking.

---

## ✨ **Key Features**

### 🖼️ **Advanced Image Lightbox**
- **One-click image preview** - Click any image to open in a sleek, responsive lightbox
- **Keyboard navigation** - Arrow keys, Home/End, and more for seamless browsing
- **Touch & swipe support** - Mobile-friendly with swipe gestures
- **Zoom & pan** - Zoom in/out (Ctrl+/-), drag to pan zoomed images
- **Rotate images** - Rotate left/right (R/Shift+R)

### 🎯 **Smart Image Detection**
- **Original vs. Edited classification** - Uses AI-like pattern matching on filenames and metadata
- **EXIF metadata extraction** - Reads camera info, dates, software, and more
- **Confidence scoring** - Visual confidence meter shows detection reliability
- **Customizable patterns** - Add your own regex patterns for detection

### 📥 **Batch Download System**
- **Download all images** - Batch download every image on the page
- **Selection mode** - Toggle selection mode to choose specific images
- **Visual progress overlay** - Real-time progress bar with thumbnail status tracking
- **Smart filename generation** - Organized folder structure with entity name and indices
- **Retry mechanism** - Automatic retries for failed downloads
- **Cancellation support** - Cancel batch downloads at any time

### 🛠️ **Metadata Panel**
- **Detection results** - See classification type, confidence, and reasoning
- **EXIF data viewer** - Full technical metadata display
- **Real-time updates** - Metadata updates as you navigate images

### 🎨 **Beautiful UI**
- **Dark theme** - Designed for AI platforms with a premium dark interface
- **Responsive design** - Works perfectly on desktop, tablet, and mobile
- **Accessibility** - ARIA labels, keyboard focus management, screen reader support
- **Animations** - Smooth transitions and visual feedback

### 🔒 **Security & Performance**
- **XSS protection** - All HTML output sanitized
- **Memory management** - Automatic cleanup of blob URLs to prevent leaks
- **Lazy loading** - Preloads nearby images for smooth navigation
- **Debounced observers** - Efficient DOM monitoring

---

## 🎯 **Installation**

1. **Install Tampermonkey** (Chrome/Edge) or **Greasemonkey** (Firefox)
2. **Click the script link** or **create a new userscript** and paste the code
3. **Enable the script** - It will automatically run on:
   - `https://arena.ai/*`
   - `https://chat.lmsys.org/*`
   - `https://lmarena.ai/*`
   - `https://www.lmarena.ai/*`

---

## ⌨️ **Keyboard Shortcuts**

| Key | Action |
|-----|--------|
| `←` `→` | Previous/Next image |
| `ESC` | Close lightbox |
| `Home` / `End` | First/Last image |
| `Ctrl +` / `Ctrl -` | Zoom in/out |
| `0` | Reset zoom |
| `R` | Rotate left |
| `Shift+R` | Rotate right |
| `M` | Toggle metadata panel |
| `D` | Download current image |
| `B` | Batch download all images |
| `S` | Toggle selection mode |
| `H` | Show help dialog |

---

## 📁 **Batch Download Structure**

```
Downloads/
└── [Page Entity Name]/
    ├── [Entity]_001_[OriginalFilename].jpg
    ├── [Entity]_002_[OriginalFilename].jpg
    └── ...
```

**Example:**
```
Downloads/
└── arena_images/
    ├── arena_images_001_photo_DSC1234.jpg
    ├── arena_images_002_edited_output.jpg
    └── arena_images_003_original_raw.jpg
```

---

## 🔍 **Original/Edited Detection Logic**

The script uses multiple heuristics to classify images:

### **Filename Patterns**
- **Original**: `original`, `source`, `input`, `reference`, `raw`, `DSC_`, `IMG_`, etc.
- **Edited**: `edited`, `modified`, `enhanced`, `output`, `result`, `_ai_`, `_generated`, `_midjourney`, etc.

### **EXIF Metadata**
- Camera make/model presence → Original
- Photoshop/Lightroom software → Edited
- ModifyDate differs from DateTimeOriginal → Edited

### **Confidence Scoring**
- 0-40%: Low confidence (suggesting generated images)
- 40-70%: Medium confidence
- 70-100%: High confidence

---

## ⚙️ **Configuration**

The script stores persistent configuration. You can modify it by editing the `DEFAULT_CONFIG` object in the script:

```javascript
const DEFAULT_CONFIG = {
    // Image Detection
    MIN_IMG_WIDTH: 50,           // Minimum image size to detect
    PRELOAD_NEIGHBORS: 2,        // Number of images to preload ahead
    TOUCH_SWIPE_THRESHOLD: 50,   // Touch sensitivity
    ZOOM_STEP: 0.2,              // Zoom increment
    MAX_ZOOM: 4,                 // Maximum zoom level
    MIN_ZOOM: 0.1,               // Minimum zoom level
    
    // Batch Download
    BATCH_DELAY_MS: 600,         // Delay between downloads
    RETRY_COUNT: 2,              // Number of retries on failure
    RETRY_DELAY_MS: 1000,        // Delay between retries
    
    // Custom Patterns
    USER_PATTERNS: {
        ORIGINAL: [],            // Add your own regex patterns
        EDITED: []               // Add your own regex patterns
    }
};
```

---

## 🛡️ **Safety & Security**

- **Sanitized outputs** - All HTML content is escaped to prevent XSS
- **Blob URL management** - Automatic cleanup prevents memory leaks
- **Error handling** - Graceful fallbacks for network failures
- **Focus management** - Proper keyboard focus traps for accessibility
- **Permission controls** - Minimal required permissions (read/write for images only)

---

## 🌟 **Why This Script?**

### **For Researchers & Developers**
- Quickly compare original vs. AI-generated images
- Batch download datasets for analysis
- Extract EXIF metadata for verification

### **For Users**
- Enhanced image viewing on AI chat platforms
- Easy image collection and organization
- Professional lightbox experience

### **For Content Creators**
- Organize generated content with smart naming
- Track image versions and modifications
- Streamlined workflow with batch processing

---

## 📝 **Changelog**

### **v6.1.0** (Current)
- ✅ Enhanced memory management with blob URL cleanup
- ✅ Added selection mode for batch downloads
- ✅ Improved EXIF parsing with caching
- ✅ Accessibility improvements (ARIA labels, focus traps)
- ✅ XSS protection for all HTML outputs
- ✅ Better mobile responsiveness

---

## 🤝 **Contributing**

Found a bug or want to request a feature? Feel free to:
- Open an issue on the GitHub repository
- Submit a pull request with improvements
- Fork and customize for your own needs

---

## 📜 **License**

This script is licensed under the MIT License. Feel free to use, modify, and distribute as needed.

---

## 🙏 **Credits**

- **Author**: TheSicknesszar
- **Domain Support**: Arena.ai & Lmarena.ai
- **Technologies**: Tampermonkey, Vanilla JS, EXIF parsing

---

## 📱 **Compatibility**

| Browser | Minimum Version | Status |
|---------|----------------|--------|
| Chrome | 88+ | ✅ Fully Supported |
| Firefox | 78+ | ✅ Fully Supported |
| Edge | 88+ | ✅ Fully Supported |
| Opera | 74+ | ✅ Fully Supported |
| Brave | 1.20+ | ✅ Fully Supported |
| Safari | 14+ | ⚠️ Limited (GM_download may not work) |

---

## 🚀 **Quick Start**

1. Install Tampermonkey
2. Add the script
3. Visit any supported domain
4. Click any image to open the lightbox
5. Press `B` to batch download all images
6. Press `S` to enter selection mode

**You're ready to go!** 🎉

---

## 💡 **Pro Tips**

- **Use selection mode** to avoid downloading unwanted images
- **Custom filename patterns** for better detection on your specific platform
- **Toggle metadata** to verify image authenticity
- **Keyboard shortcuts** speed up your workflow significantly

---

**Download, rate, and star this script if you find it useful!** ⭐️

---

*Created with ❤️ for the Arena.ai and AI research community*
