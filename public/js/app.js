// ==========================================================================
// CENTRAL STATE GRAPH INITIALIZATION
// ==========================================================================
let currentPlanData = null; 
let selectedWeekIndex = 0;  
let generatedFlashcards = []; 
let activeCardIndex = 0;    

const doc = id => document.getElementById(id);
const forms = {
    setup: doc('syllabusForm'),
    fileInput: doc('syllabusFile'),
    dropZone: doc('dropZone'),
    fileName: doc('fileSelectedName'),
    submitBtn: doc('generateBtn')
};
const views = {
    empty: doc('emptyWorkspace'),
    active: doc('activeWorkspace'),
    spinner: doc('loadingState'),
    weeksNav: doc('weeksList'),
    courseTitle: doc('courseTitle'),
    themeSelector: doc('themeSelect')
};

// ==========================================================================
// THEME DYNAMIC SELECTOR SPECIFICATION ENGINE
// ==========================================================================
// Checks for a previously saved theme preference, defaulting to your clean 'light-default' style
const savedTheme = localStorage.getItem('app-user-theme') || 'light-default';
document.body.setAttribute('data-theme', savedTheme);
views.themeSelector.value = savedTheme;

views.themeSelector.addEventListener('change', (e) => {
    const selectedValue = e.target.value;
    document.body.setAttribute('data-theme', selectedValue);
    localStorage.setItem('app-user-theme', selectedValue);
});

// ==========================================================================
// FILE INPUT CONTROLS & SELECTIONS HANDLERS
// ==========================================================================
forms.dropZone.addEventListener('click', () => forms.fileInput.click());
forms.fileInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    forms.fileName.textContent = file ? file.name : "No file selected";
});

// ==========================================================================
// FORM TRANSMISSION PAYLOAD REFINEMENT
// ==========================================================================
forms.setup.addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const file = forms.fileInput.files[0];
    if (!file) return alert('Please assign a core PDF syllabus asset first.');

    // Construct the payload with exact matching key tokens
    const formData = new FormData();
    formData.append('syllabus', file); // MUST match upload.single('syllabus') exactly
    formData.append('examDate', doc('examDate').value);
    formData.append('weeklyHours', doc('weeklyHours').value);

    // ... balance of your loading toggle and fetch calls continue below ...

    // Swap states into interactive loading configurations
    views.spinner.classList.remove('hidden');
    forms.submitBtn.disabled = true;
    views.empty.classList.remove('hidden');
    views.active.classList.add('hidden');

    try {
        const response = await fetch('/api/parse-syllabus', {
            method: 'POST',
            body: formData
        });

        if (!response.ok) throw new Error('Network responded with systemic layout failure.');

        currentPlanData = await response.json();
        
        views.empty.classList.add('hidden');
        views.active.classList.remove('hidden');
        
        renderTimelineNavigation(currentPlanData);
        switchActiveWeekWorkspace(0); 
        calculateOverallProgress();

    } catch (error) {
        console.error("UI Core Thread Error:", error);
        alert('An issue occurred while converting your document. Verify system endpoints.');
    } finally {
        views.spinner.classList.add('hidden');
        forms.submitBtn.disabled = false;
    }
});

// ==========================================================================
// DYNAMIC COMPONENT RENDER ENGINE
// ==========================================================================
function renderTimelineNavigation(plan) {
    views.courseTitle.textContent = plan.courseName || "My Academic Course";
    views.weeksNav.innerHTML = '';

    plan.schedule.forEach((item, index) => {
        const li = document.createElement('li');
        li.className = `week-item ${index === 0 ? 'active' : ''}`;
        li.innerHTML = `<span>Week ${item.week}</span><i class="fa-solid fa-chevron-right"></i>`;
        
        li.addEventListener('click', () => {
            document.querySelectorAll('.week-item').forEach(el => el.classList.remove('active'));
            li.classList.add('active');
            switchActiveWeekWorkspace(index);
        });
        views.weeksNav.appendChild(li);
    });
}

function switchActiveWeekWorkspace(index) {
    selectedWeekIndex = index;
    const targetModule = currentPlanData.schedule[index];

    doc('activeWeekTitle').textContent = `Week ${targetModule.week} Core Focus`;
    doc('activeWeekHours').textContent = `Estimated: ${targetModule.estimatedHours || '--'} hrs`;
    doc('activeTopicName').textContent = targetModule.topicTitle;

    const checklistContainer = doc('subtopicsChecklist');
    checklistContainer.innerHTML = '';

    const storageChecklistKey = `progress_course_${views.courseTitle.textContent}_week_${targetModule.week}`;
    const historicalProgressState = JSON.parse(localStorage.getItem(storageChecklistKey)) || {};

    targetModule.subtopics.forEach((sub, subIdx) => {
        const li = document.createElement('li');
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.id = `sub_${index}_${subIdx}`;
        checkbox.checked = !!historicalProgressState[subIdx];

        checkbox.addEventListener('change', () => {
            historicalProgressState[subIdx] = checkbox.checked;
            localStorage.setItem(storageChecklistKey, JSON.stringify(historicalProgressState));
            calculateOverallProgress();
        });

        const label = document.createElement('label');
        label.setAttribute('for', checkbox.id);
        label.textContent = sub;

        li.appendChild(checkbox);
        li.appendChild(label);
        checklistContainer.appendChild(li);
    });

    const storageNotesKey = `notes_course_${views.courseTitle.textContent}_week_${targetModule.week}`;
    doc('notesArea').value = localStorage.getItem(storageNotesKey) || '';
    doc('saveStatus').textContent = "Draft retrieved from profile storage.";

    resetFlashcardUIComponents();
}

function calculateOverallProgress() {
    if (!currentPlanData) return;
    
    let totalItemsCount = 0;
    let checkedItemsCount = 0;

    currentPlanData.schedule.forEach((item) => {
        const key = `progress_course_${views.courseTitle.textContent}_week_${item.week}`;
        const state = JSON.parse(localStorage.getItem(key)) || {};
        
        item.subtopics.forEach((_, subIdx) => {
            totalItemsCount++;
            if (state[subIdx]) checkedItemsCount++;
        });
    });

    const outputRatio = totalItemsCount > 0 ? Math.round((checkedItemsCount / totalItemsCount) * 100) : 0;
    doc('progressPercentage').textContent = `Progress: ${outputRatio}%`;
    doc('progressFill').style.width = `${outputRatio}%`;
}

doc('saveNotesBtn').addEventListener('click', () => {
    if (!currentPlanData) return;
    const targetModule = currentPlanData.schedule[selectedWeekIndex];
    const storageNotesKey = `notes_course_${views.courseTitle.textContent}_week_${targetModule.week}`;
    
    localStorage.setItem(storageNotesKey, doc('notesArea').value);
    doc('saveStatus').textContent = "All changes saved locally!";
    setTimeout(() => { doc('saveStatus').textContent = "All notes saved locally"; }, 2000);
});

// ==========================================================================
// ACTIVE RECALL MODULE FUNCTIONALITY
// ==========================================================================
function resetFlashcardUIComponents() {
    doc('flashcardEmpty').classList.remove('hidden');
    doc('flashcardContainer').classList.add('hidden');
    doc('flashcardControls').classList.add('hidden');
    doc('flashcardContainer').classList.remove('flipped');
}

// ==========================================================================
// DYNAMIC ACTIVE RECALL MODULE GENERATION PIPELINE
// ==========================================================================
doc('generateCardsBtn').addEventListener('click', async () => {
    const notesValue = doc('notesArea').value.trim();
    if (notesValue.length < 15) {
        return alert('Type dynamic study notes above so our client module can structure flashcards.');
    }

    // Visual indicators: show the loading state or disable button
    doc('generateCardsBtn').disabled = true;
    doc('generateCardsBtn').innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Generating...';

    try {
        const response = await fetch('/api/generate-flashcards', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ notes: notesValue })
        });

        if (!response.ok) throw new Error('Failed to generate flashcards from server.');

        // Swap the client data state with real Gemini responses!
        generatedFlashcards = await response.json();

        if (generatedFlashcards.length === 0) {
            alert("Gemini couldn't find distinct concepts to map. Add more detail to your notes!");
            resetFlashcardUIComponents();
            return;
        }

        activeCardIndex = 0;
        doc('flashcardEmpty').classList.add('hidden');
        doc('flashcardContainer').classList.remove('hidden');
        doc('flashcardControls').classList.remove('hidden');
        hydrateCardFields();

    } catch (error) {
        console.error("Flashcard Fetch UI Error:", error);
        alert('An error occurred while building your cards. Check server logs.');
        resetFlashcardUIComponents();
    } finally {
        doc('generateCardsBtn').disabled = false;
        doc('generateCardsBtn').innerHTML = '<i class="fa-solid fa-wand-magic-sparkles"></i> Generate Flashcards';
    }
});

doc('flashcardContainer').addEventListener('click', () => {
    doc('flashcardContainer').classList.toggle('flipped');
});

function hydrateCardFields() {
    doc('flashcardContainer').classList.remove('flipped');
    setTimeout(() => {
        const targetCard = generatedFlashcards[activeCardIndex];
        doc('cardQuestionText').textContent = targetCard.q;
        doc('cardAnswerText').textContent = targetCard.a;
        doc('cardTrackerIndex').textContent = `Card ${activeCardIndex + 1} of ${generatedFlashcards.length}`;
    }, 150);
}

doc('nextCardBtn').addEventListener('click', () => {
    if (activeCardIndex < generatedFlashcards.length - 1) {
        activeCardIndex++;
        hydrateCardFields();
    }
});

doc('prevCardBtn').addEventListener('click', () => {
    if (activeCardIndex > 0) {
        activeCardIndex--;
        hydrateCardFields();
    }
});

// ==========================================================================
// UPGRADED WORKSPACE OVERWRITE & FORMATTING PIPELINE
// ==========================================================================
const summarizeBtn = document.getElementById('aiSummarizeBtn');

if (summarizeBtn) {
    summarizeBtn.addEventListener('click', async () => {
        const notesArea = doc('notesArea');
        const currentNotesText = notesArea.value.trim();

        if (currentNotesText.length < 10) {
            return alert('Please write or paste some concept text inside the notes workspace block first!');
        }

        const originalButtonHtml = summarizeBtn.innerHTML;
        summarizeBtn.disabled = true;
        summarizeBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Processing...';

        try {
            const response = await fetch('/api/summarize-notes', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ notes: currentNotesText })
            });

            if (!response.ok) throw new Error('Summarization system endpoint failure.');

            const data = await response.json();
            
            // CLEAN UP STAGE: Strip markdown characters (##, **, __, etc.) for a clean readable view
            let cleanSummary = data.summary
                .replace(/[#*`_-]/g, '') // Clears headers, bolding stars, and dashes
                .trim();

            // OVERWRITE: Wipe old messy notes and insert only the clean summary text
            notesArea.value = `📜 AI EXPANDED SUMMARY\n=====================\n\n${cleanSummary}`;
            
            // Trigger auto-save persistence engine
            doc('saveNotesBtn')?.click();
            doc('saveStatus').textContent = "Summary populated and old notes cleared!";

        } catch (error) {
            console.error("Summarizer UI Failure:", error);
            alert('An issue occurred while interpreting your study shorthand.');
        } finally {
            summarizeBtn.disabled = false;
            summarizeBtn.innerHTML = originalButtonHtml;
        }
    });
}

// ==========================================================================
// WORKSPACE THEATER MODE FULL-SCREEN TOGGLE ENGINE
// ==========================================================================
const expandLink = document.getElementById('expandWorkspaceLink');

if (expandLink) {
    expandLink.addEventListener('click', () => {
        // Toggle the theater mode class directly onto the global body tag
        const theaterModeActive = document.body.classList.toggle('theater-mode-active');
        
        if (theaterModeActive) {
            // Update the link text and swap the expand icon to a compress icon
            expandLink.innerHTML = '<i class="fa-solid fa-compress"></i> Collapse Workspace View';
            doc('notesArea').focus();
        } else {
            // Revert back to the normal dashboard grid look
            expandLink.innerHTML = '<i class="fa-solid fa-expand"></i> Expand Workspace View';
        }
    });
}

// ==========================================================================
// DYNAMIC SERVER HISTORY STREAMING ARCHITECTURE (FOOLPROOF ENGINE)
// ==========================================================================
async function streamHistoricalDatabaseLogs() {
    const historyContainer = document.getElementById('historyPlanList');
    if (!historyContainer) return;

    try {
        const response = await fetch('/api/history');
        if (!response.ok) throw new Error("History collection failure.");
        
        const databaseRecords = await response.json();
        
        if (!databaseRecords || databaseRecords.length === 0) {
            historyContainer.innerHTML = `<li style="font-size: 11px; opacity: 0.6; padding: 6px; list-style: none;">No saved history profiles yet.</li>`;
            return;
        }

        // Clear placeholders cleanly
        historyContainer.innerHTML = '';

        databaseRecords.forEach(record => {
            const planItem = document.createElement('li');
            planItem.className = 'history-item-link';
            planItem.style.cssText = 'padding: 8px 12px; border-radius: 6px; background: rgba(0,0,0,0.04); font-size: 12px; cursor: pointer; display: flex; flex-direction: column; transition: all 0.2s; margin-bottom: 4px; list-style: none;';
            
            planItem.innerHTML = `
                <strong style="color: var(--accent);">${record.data?.courseName || 'Unparsed Course Plan'}</strong>
                <span style="font-size: 10px; opacity: 0.7; margin-top: 2px;"><i class="fa-solid fa-calendar"></i> ${record.timestamp} — Weeks: ${record.data?.totalEstimatedWeeks || '--'}</span>
            `;

            planItem.addEventListener('mouseenter', () => planItem.style.background = 'rgba(0,0,0,0.08)');
            planItem.addEventListener('mouseleave', () => planItem.style.background = 'rgba(0,0,0,0.04)');

            // SAFE UI WORKSPACE HYDRATION
            planItem.addEventListener('click', () => {
                if (!record.data) return alert("Historical data payload is corrupted.");
                
                // Sync global variable if it exists in your app context
                if (typeof activeScheduleData !== 'undefined') activeScheduleData = record.data;
                
                // Safe element updates using optional chaining
                const courseTitleEl = document.getElementById('courseTitle');
                if (courseTitleEl) courseTitleEl.textContent = record.data.courseName;

                // Safely toggle display layouts without breaking execution loops
                document.getElementById('emptyWorkspace')?.classList.add('hidden');
                document.getElementById('activeWorkspace')?.classList.remove('hidden');

                // Execute core ui re-rendering pipelines dynamically
                if (typeof renderTimelineWeeks === 'function') {
                    renderTimelineWeeks(record.data);
                } else if (typeof renderWeeksMenu === 'function') {
                    renderWeeksMenu(record.data);
                } else if (typeof displaySchedule === 'function') {
                    displaySchedule(record.data);
                } else {
                    console.log("History selected. Please refresh or select a specific week link manually.");
                }
                
                alert(`Loaded workspace for: ${record.data.courseName}`);
            });

            historyContainer.appendChild(planItem);
        });

    } catch (err) {
        console.error("UI History rendering exception pipeline:", err);
    }
}

// Fire the log load sequence immediately when DOM structure mounts
document.addEventListener('DOMContentLoaded', streamHistoricalDatabaseLogs);