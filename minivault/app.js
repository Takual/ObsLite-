(function () {
    'use strict';

    const STORAGE_KEY = 'minivault_notes';
    const META_KEY = 'minivault_meta';
    const PROJECTS_KEY = 'minivault_projects';
    const INIT_KEY = 'minivault_initialized';
    const SORT_KEY = 'minivault_sort';
    const SYNC_TOKEN_KEY = 'minivault_sync_token';
    const SYNC_GIST_KEY = 'minivault_sync_gist_id';
    const SYNC_LAST_KEY = 'minivault_sync_last';
    const DEFAULT_NOTE = 'home';

    const DEFAULT_NOTES = [
        'home', 'beispiel-notiz', 'zweite-notiz',
        'projekt-webshop', 'meeting-2026-06-25', 'webshop-seo-recherche', 'webshop-design-ideen',
        'projekt-podcast', 'podcast-equipment',
        'projekt-gartenhaus', 'gartenhaus-materialliste',
        'idee-newsletter', 'idee-second-brain', 'idee-geschenkefinder',
        'leseliste', 'buchnotizen-atomic-habits',
        'fitness-tracker', 'rezept-thai-curry', 'urlaub-2026'
    ];

    const TEMPLATES = [
        { id: 'empty', name: 'Leere Notiz', desc: 'Nur ein Titel', content: '# {{title}}\n\n' },
        { id: 'daily', name: 'Tagesnotiz', desc: 'Struktur für den Tag', content: '# {{date}}\n\n## Aufgaben\n\n- [ ] \n\n## Notizen\n\n\n\n## Ideen\n\n\n' },
        { id: 'meeting', name: 'Meeting', desc: 'Protokoll-Vorlage', content: '# Meeting: {{title}}\n\n**Datum:** {{date}}  \n**Teilnehmer:** \n\n## Agenda\n\n1. \n\n## Notizen\n\n\n\n## Action Items\n\n- [ ] \n' },
        { id: 'idea', name: 'Idee', desc: 'Idee festhalten', content: '# Idee: {{title}}\n\n**Status:** #offen\n\n## Beschreibung\n\n\n\n## Nächste Schritte\n\n- [ ] \n\n## Verknüpfungen\n\n' },
        { id: 'project', name: 'Projektseite', desc: 'Übersicht für ein Projekt', content: '# Projekt: {{title}}\n\n**Status:** #aktiv  \n**Erstellt:** {{date}}\n\n## Ziel\n\n\n\n## Aufgaben\n\n- [ ] \n\n## Notizen & Links\n\n\n\n## Ideen\n\n\n' },
        { id: 'link', name: 'Link/Ressource', desc: 'Webseite oder Quelle speichern', content: '# {{title}}\n\n**Link:** \n**Gespeichert:** {{date}}\n\n## Zusammenfassung\n\n\n\n## Notizen\n\n\n' }
    ];

    let notes = {};
    let meta = {};
    let projects = [];
    let currentNote = null;
    let editMode = false;
    let currentPanel = 'notes';
    let activeTagFilter = null;
    let activeProjectFilter = null;
    let sortMode = 'name';

    const $ = (sel) => document.querySelector(sel);
    const $$ = (sel) => document.querySelectorAll(sel);

    // --- Storage ---

    function saveNotes() {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(notes));
        localStorage.setItem(META_KEY, JSON.stringify(meta));
    }

    function saveProjects() {
        localStorage.setItem(PROJECTS_KEY, JSON.stringify(projects));
    }

    function loadNotes() {
        const stored = localStorage.getItem(STORAGE_KEY);
        if (stored) notes = JSON.parse(stored);
        const storedMeta = localStorage.getItem(META_KEY);
        if (storedMeta) meta = JSON.parse(storedMeta);
        const storedProjects = localStorage.getItem(PROJECTS_KEY);
        if (storedProjects) projects = JSON.parse(storedProjects);
        const storedSort = localStorage.getItem(SORT_KEY);
        if (storedSort) sortMode = storedSort;
    }

    function getMeta(name) {
        if (!meta[name]) {
            meta[name] = { created: Date.now(), modified: Date.now(), project: null };
        }
        return meta[name];
    }

    function touchMeta(name) {
        getMeta(name).modified = Date.now();
    }

    // --- Init ---

    async function init() {
        loadNotes();

        const INIT_VERSION = '2';
        if (localStorage.getItem(INIT_KEY) !== INIT_VERSION) {
            await loadDefaultNotes();
            localStorage.setItem(INIT_KEY, INIT_VERSION);
        }

        ensureMetaForAll();
        handleSharedContent();

        const sortSel = $('#sort-select');
        if (sortSel) sortSel.value = sortMode;

        renderFilterBar();
        renderNoteList();
        navigateTo(getHashNote() || DEFAULT_NOTE);
        setupEventListeners();
        registerServiceWorker();
        updateSyncIndicator();
        autoSync();
    }

    const DEFAULT_PROJECT_MAP = {
        'projekt-webshop': 'Webshop Relaunch',
        'meeting-2026-06-25': 'Webshop Relaunch',
        'webshop-seo-recherche': 'Webshop Relaunch',
        'webshop-design-ideen': 'Webshop Relaunch',
        'idee-geschenkefinder': 'Webshop Relaunch',
        'projekt-podcast': 'Podcast',
        'podcast-equipment': 'Podcast',
        'idee-newsletter': 'Podcast',
        'projekt-gartenhaus': 'Gartenhaus',
        'gartenhaus-materialliste': 'Gartenhaus',
        'urlaub-2026': 'Urlaub Kroatien'
    };

    async function loadDefaultNotes() {
        for (const name of DEFAULT_NOTES) {
            if (notes[name]) continue;
            try {
                const resp = await fetch('vault/' + name + '.md');
                if (resp.ok) notes[name] = await resp.text();
            } catch (e) {
                notes[name] = '# ' + name + '\n\nNeue Notiz.';
            }
            getMeta(name);
            if (DEFAULT_PROJECT_MAP[name]) {
                meta[name].project = DEFAULT_PROJECT_MAP[name];
                if (!projects.includes(DEFAULT_PROJECT_MAP[name])) {
                    projects.push(DEFAULT_PROJECT_MAP[name]);
                }
            }
        }
        saveNotes();
        saveProjects();
    }

    function ensureMetaForAll() {
        for (const name of Object.keys(notes)) {
            getMeta(name);
        }
    }

    function registerServiceWorker() {
        if ('serviceWorker' in navigator) {
            navigator.serviceWorker.register('./sw.js');
        }
    }

    // --- Tags ---

    function extractTags(content) {
        if (!content) return [];
        const matches = content.match(/(?:^|\s)#([a-zA-ZäöüÄÖÜß][a-zA-Z0-9äöüÄÖÜß_-]*)/g);
        if (!matches) return [];
        return [...new Set(matches.map(m => m.trim().slice(1).toLowerCase()))];
    }

    function getAllTags() {
        const tags = new Set();
        for (const content of Object.values(notes)) {
            extractTags(content).forEach(t => tags.add(t));
        }
        return [...tags].sort();
    }

    // --- Projects ---

    function getAllProjects() {
        const projectSet = new Set(projects);
        for (const m of Object.values(meta)) {
            if (m.project) projectSet.add(m.project);
        }
        return [...projectSet].sort();
    }

    function assignProject(noteName, projectName) {
        getMeta(noteName).project = projectName || null;
        if (projectName && !projects.includes(projectName)) {
            projects.push(projectName);
            saveProjects();
        }
        saveNotes();
    }

    // --- Share Target ---

    function handleSharedContent() {
        const params = new URLSearchParams(window.location.search);
        const sharedTitle = params.get('shared_title') || '';
        const sharedText = params.get('shared_text') || '';
        const sharedUrl = params.get('shared_url') || '';
        if (!sharedTitle && !sharedText && !sharedUrl) return;

        const title = sharedTitle || sharedText.slice(0, 40) || 'geteilter-inhalt';
        const slug = findUniqueSlug(slugify(title) || 'geteilt-' + Date.now());

        let content = '# ' + title + '\n\n*Gespeichert am ' + formatDate(new Date()) + '*\n\n';
        if (sharedUrl) content += '**Link:** ' + sharedUrl + '\n\n';
        if (sharedText && sharedText !== sharedUrl) content += sharedText + '\n';

        notes[slug] = content;
        getMeta(slug);
        saveNotes();
        window.history.replaceState({}, '', window.location.pathname + '#' + slug);
        showToast('Notiz "' + slug + '" erstellt');
        currentNote = slug;
    }

    function findUniqueSlug(slug) {
        if (!notes[slug]) return slug;
        let i = 2;
        while (notes[slug + '-' + i]) i++;
        return slug + '-' + i;
    }

    // --- Fulltext Search ---

    function searchNotes(query) {
        if (!query || query.length < 2) return null;
        const q = query.toLowerCase();
        const results = [];
        for (const [name, content] of Object.entries(notes)) {
            const nameMatch = name.toLowerCase().includes(q);
            const contentLower = (content || '').toLowerCase();
            const contentMatch = contentLower.includes(q);
            if (nameMatch || contentMatch) {
                let snippet = '';
                if (contentMatch) {
                    const idx = contentLower.indexOf(q);
                    const start = Math.max(0, idx - 30);
                    const end = Math.min(content.length, idx + q.length + 30);
                    snippet = (start > 0 ? '...' : '') + content.slice(start, end).replace(/\n/g, ' ') + (end < content.length ? '...' : '');
                }
                results.push({ name, snippet, nameMatch });
            }
        }
        results.sort((a, b) => (b.nameMatch ? 1 : 0) - (a.nameMatch ? 1 : 0));
        return results;
    }

    // --- Daily Note ---

    function createDailyNote() {
        const today = formatDate(new Date());
        const slug = today;
        if (notes[slug]) {
            navigateTo(slug);
            showPanel('view');
            return;
        }

        const template = TEMPLATES.find(t => t.id === 'daily');
        notes[slug] = template.content.replace(/\{\{date\}\}/g, today).replace(/\{\{title\}\}/g, today);
        getMeta(slug);
        saveNotes();
        renderNoteList();
        navigateTo(slug);
        showPanel('view');
        showToast('Tagesnotiz ' + today + ' erstellt');
    }

    // --- Panel Navigation ---

    const isMobile = () => window.innerWidth < 768;

    function showPanel(name) {
        currentPanel = name;
        $$('.panel').forEach(p => p.classList.remove('active'));
        if (isMobile() && (name === 'view' || name === 'edit')) {
            name = 'mobile-note';
        }
        const panel = $('#panel-' + name);
        if (panel) panel.classList.add('active');
        $$('#bottom-nav button').forEach(b => b.classList.remove('active'));
        const navBtn = $('#nav-' + (name === 'mobile-note' ? 'view' : name));
        if (navBtn) navBtn.classList.add('active');
    }

    function openMobileNote(name) {
        const textarea = $('#mobile-textarea');
        const titleEl = $('#mobile-note-title');
        if (textarea) textarea.value = notes[name] || '';
        if (titleEl) titleEl.textContent = name;
        hideMobilePreview();
        showPanel('mobile-note');
        $$('#bottom-nav button').forEach(b => b.classList.remove('active'));
        $('#nav-view').classList.add('active');
    }

    function hideMobilePreview() {
        const preview = $('#mobile-preview');
        const btn = $('#btn-mobile-preview');
        if (preview) preview.classList.remove('active');
        if (btn) btn.classList.remove('active');
    }

    function toggleMobilePreview() {
        const preview = $('#mobile-preview');
        const btn = $('#btn-mobile-preview');
        const textarea = $('#mobile-textarea');
        if (!preview) return;
        if (preview.classList.contains('active')) {
            preview.classList.remove('active');
            btn.classList.remove('active');
            if (textarea) textarea.style.display = '';
        } else {
            preview.innerHTML = renderMarkdown(notes[currentNote] || '');
            bindMobilePreviewLinks();
            preview.classList.add('active');
            btn.classList.add('active');
            if (textarea) textarea.style.display = 'none';
        }
    }

    function bindMobilePreviewLinks() {
        $('#mobile-preview').querySelectorAll('.wikilink').forEach(el => {
            el.addEventListener('click', (e) => {
                e.preventDefault();
                const target = el.dataset.note;
                if (!notes[target]) {
                    notes[target] = '# ' + target + '\n\nNeue Notiz.';
                    getMeta(target);
                    saveNotes();
                }
                navigateTo(target);
            });
        });
        $('#mobile-preview').querySelectorAll('.inline-tag').forEach(el => {
            el.addEventListener('click', () => {
                activeTagFilter = el.dataset.tag;
                activeProjectFilter = null;
                renderFilterBar();
                renderNoteList();
                showPanel('notes');
            });
        });
    }

    function saveMobileNote() {
        if (!currentNote) return;
        const textarea = $('#mobile-textarea');
        if (textarea) {
            notes[currentNote] = textarea.value;
            touchMeta(currentNote);
            saveNotes();
            renderFilterBar();
            renderNoteList();
            showToast('Gespeichert');
        }
    }

    function updateTopBar() {}

    // --- Rendering ---

    function renderFilterBar() {
        const bar = $('#filter-bar');
        const tags = getAllTags();
        const projs = getAllProjects();
        if (tags.length === 0 && projs.length === 0) {
            bar.classList.remove('visible');
            return;
        }
        bar.classList.add('visible');
        bar.innerHTML = '';

        for (const p of projs) {
            const chip = document.createElement('span');
            chip.className = 'filter-chip project' + (activeProjectFilter === p ? ' active' : '');
            chip.textContent = '📁 ' + p;
            chip.onclick = () => {
                activeProjectFilter = activeProjectFilter === p ? null : p;
                activeTagFilter = null;
                renderFilterBar();
                renderNoteList();
            };
            bar.appendChild(chip);
        }

        for (const t of tags) {
            const chip = document.createElement('span');
            chip.className = 'filter-chip tag' + (activeTagFilter === t ? ' active' : '');
            chip.textContent = '#' + t;
            chip.onclick = () => {
                activeTagFilter = activeTagFilter === t ? null : t;
                activeProjectFilter = null;
                renderFilterBar();
                renderNoteList();
            };
            bar.appendChild(chip);
        }
    }

    function renderNoteList(filter) {
        const list = $('#note-list');
        let searchResults = null;

        if (filter && filter.length >= 2) {
            searchResults = searchNotes(filter);
        }

        let noteNames = searchResults ? searchResults.map(r => r.name) : Object.keys(notes);

        if (!searchResults) {
            if (activeTagFilter) {
                noteNames = noteNames.filter(n => extractTags(notes[n]).includes(activeTagFilter));
            }
            if (activeProjectFilter) {
                noteNames = noteNames.filter(n => getMeta(n).project === activeProjectFilter);
            }
        }

        if (!searchResults) {
            noteNames = sortNoteNames(noteNames);
        }

        list.innerHTML = '';
        for (const name of noteNames) {
            const div = document.createElement('div');
            div.className = 'note-item' + (name === currentNote ? ' active' : '');

            const contentDiv = document.createElement('div');
            contentDiv.className = 'note-item-content';

            const span = document.createElement('span');
            span.className = 'note-item-name';
            span.textContent = name;
            contentDiv.appendChild(span);

            const metaDiv = document.createElement('div');
            metaDiv.className = 'note-item-meta';

            const m = getMeta(name);
            if (m.project) {
                const projSpan = document.createElement('span');
                projSpan.textContent = '📁 ' + m.project;
                projSpan.style.color = 'var(--project-color)';
                metaDiv.appendChild(projSpan);
            }

            const tags = extractTags(notes[name]);
            if (tags.length > 0) {
                const tagSpan = document.createElement('span');
                tagSpan.className = 'note-item-tags';
                tagSpan.innerHTML = tags.slice(0, 3).map(t => '<span class="inline-tag">#' + t + '</span>').join(' ');
                metaDiv.appendChild(tagSpan);
            }

            if (sortMode === 'modified' || sortMode === 'created') {
                const dateSpan = document.createElement('span');
                const d = new Date(sortMode === 'modified' ? m.modified : m.created);
                dateSpan.textContent = formatDate(d);
                metaDiv.appendChild(dateSpan);
            }

            contentDiv.appendChild(metaDiv);

            if (searchResults) {
                const result = searchResults.find(r => r.name === name);
                if (result && result.snippet) {
                    const snippetDiv = document.createElement('div');
                    snippetDiv.style.cssText = 'font-size:0.78rem;color:var(--text-muted);margin-top:2px;';
                    snippetDiv.textContent = result.snippet;
                    contentDiv.appendChild(snippetDiv);
                }
            }

            div.appendChild(contentDiv);

            div.onclick = () => {
                navigateTo(name);
                showPanel('view');
            };

            if (name !== 'home') {
                const del = document.createElement('button');
                del.className = 'delete-btn';
                del.textContent = '×';
                del.onclick = (e) => {
                    e.stopPropagation();
                    deleteNote(name);
                };
                div.appendChild(del);
            }

            list.appendChild(div);
        }

        if (noteNames.length === 0) {
            list.innerHTML = '<div style="padding:20px;color:var(--text-muted);text-align:center;">Keine Notizen gefunden</div>';
        }
    }

    function sortNoteNames(names) {
        return names.sort((a, b) => {
            if (a === 'home') return -1;
            if (b === 'home') return 1;
            switch (sortMode) {
                case 'modified':
                    return (getMeta(b).modified || 0) - (getMeta(a).modified || 0);
                case 'created':
                    return (getMeta(b).created || 0) - (getMeta(a).created || 0);
                default:
                    return a.localeCompare(b);
            }
        });
    }

    function renderNote() {
        if (!currentNote || !notes[currentNote]) return;

        const content = notes[currentNote];
        updateTopBar();

        const dtTitle = $('#desktop-note-title');
        if (dtTitle) dtTitle.textContent = currentNote;
        const dtEdit = $('#btn-edit-desktop');
        if (dtEdit) {
            dtEdit.textContent = editMode ? 'Ansicht' : 'Bearbeiten';
            dtEdit.classList.toggle('active', editMode);
        }

        renderNoteMetaBar();

        $('#viewer').innerHTML = renderMarkdown(content);
        bindWikilinks();
        bindInlineTags();

        const textarea = $('#panel-edit textarea');
        if (textarea) textarea.value = content;

        if (window.innerWidth >= 768) {
            if (editMode) {
                $('#panel-view').classList.add('has-editor');
                $('#panel-edit').classList.add('active');
            } else {
                $('#panel-view').classList.remove('has-editor');
                $('#panel-edit').classList.remove('active');
            }
        }

        renderBacklinks();
        renderOutline();
    }

    function renderNoteMetaBar() {
        let bar = $('#note-meta-bar');
        if (!bar) {
            bar = document.createElement('div');
            bar.id = 'note-meta-bar';
            bar.className = 'note-meta-bar';
            $('#viewer').parentNode.insertBefore(bar, $('#viewer'));
        }
        bar.innerHTML = '';

        const m = getMeta(currentNote);
        const tags = extractTags(notes[currentNote]);

        if (m.project) {
            const proj = document.createElement('span');
            proj.className = 'meta-project';
            proj.textContent = '📁 ' + m.project;
            proj.onclick = () => {
                activeProjectFilter = m.project;
                activeTagFilter = null;
                renderFilterBar();
                renderNoteList();
                showPanel('notes');
            };
            bar.appendChild(proj);
        }

        const projBtn = document.createElement('button');
        projBtn.className = 'meta-project-btn';
        projBtn.textContent = m.project ? '✎ Projekt' : '+ Projekt';
        projBtn.onclick = showProjectModal;
        bar.appendChild(projBtn);

        for (const t of tags) {
            const tag = document.createElement('span');
            tag.className = 'meta-tag';
            tag.textContent = '#' + t;
            tag.onclick = () => {
                activeTagFilter = t;
                activeProjectFilter = null;
                renderFilterBar();
                renderNoteList();
                showPanel('notes');
            };
            bar.appendChild(tag);
        }

        const dateSpan = document.createElement('span');
        dateSpan.className = 'meta-date';
        dateSpan.textContent = formatDate(new Date(m.modified));
        bar.appendChild(dateSpan);
    }

    function renderMarkdown(text) {
        const wikilinkPlaceholders = [];
        let processed = text.replace(/\[\[([^\]]+)\]\]/g, (match, name) => {
            const slug = slugify(name);
            const exists = notes.hasOwnProperty(slug);
            const placeholder = '\x00WL' + wikilinkPlaceholders.length + '\x00';
            wikilinkPlaceholders.push(
                '<a class="wikilink' + (exists ? '' : ' broken') + '" data-note="' + slug + '">' + name + '</a>'
            );
            return placeholder;
        });

        processed = processed.replace(/(?:^|\s)#([a-zA-ZäöüÄÖÜß][a-zA-Z0-9äöüÄÖÜß_-]*)/g, (match, tag) => {
            const leading = match.startsWith('#') ? '' : match[0];
            return leading + '<span class="inline-tag" data-tag="' + tag.toLowerCase() + '">#' + tag + '</span>';
        });

        let html = marked.parse(processed);

        wikilinkPlaceholders.forEach((replacement, i) => {
            html = html.replace('\x00WL' + i + '\x00', replacement);
        });

        return html;
    }

    function bindWikilinks() {
        $$('#viewer .wikilink').forEach(el => {
            el.addEventListener('click', (e) => {
                e.preventDefault();
                const target = el.dataset.note;
                if (!notes[target]) {
                    notes[target] = '# ' + target + '\n\nNeue Notiz.';
                    getMeta(target);
                    saveNotes();
                    renderNoteList();
                }
                navigateTo(target);
                showPanel('view');
            });
        });
    }

    function bindInlineTags() {
        $$('#viewer .inline-tag').forEach(el => {
            el.addEventListener('click', (e) => {
                e.preventDefault();
                activeTagFilter = el.dataset.tag;
                activeProjectFilter = null;
                renderFilterBar();
                renderNoteList();
                showPanel('notes');
            });
        });
    }

    function renderBacklinks() {
        const list = $('#backlinks-list');
        list.innerHTML = '';
        if (!currentNote) return;

        const pattern = '[[' + currentNote + ']]';
        for (const [name, content] of Object.entries(notes)) {
            if (name === currentNote) continue;
            if (content && content.includes(pattern)) {
                const div = document.createElement('div');
                div.className = 'backlink-item';

                const title = document.createElement('div');
                title.textContent = name;
                div.appendChild(title);

                const idx = content.indexOf(pattern);
                const start = Math.max(0, idx - 40);
                const end = Math.min(content.length, idx + pattern.length + 40);
                const ctx = document.createElement('div');
                ctx.className = 'backlink-context';
                ctx.textContent = '...' + content.slice(start, end).replace(/\n/g, ' ') + '...';
                div.appendChild(ctx);

                div.onclick = () => { navigateTo(name); showPanel('view'); };
                list.appendChild(div);
            }
        }

        if (!list.children.length) {
            list.innerHTML = '<div style="padding:16px;color:var(--text-muted);font-size:0.9rem;">Keine Backlinks</div>';
        }
    }

    function renderOutline() {
        const list = $('#outline-list');
        if (!list) return;
        list.innerHTML = '';
        if (!currentNote || !notes[currentNote]) return;

        const headings = [];
        notes[currentNote].split('\n').forEach(line => {
            const match = line.match(/^(#{1,3})\s+(.+)/);
            if (match) {
                headings.push({ level: match[1].length, text: match[2].trim() });
            }
        });

        if (headings.length === 0) {
            list.innerHTML = '<div style="padding:16px;color:var(--text-muted);font-size:0.9rem;">Keine Überschriften</div>';
            return;
        }

        for (const h of headings) {
            const div = document.createElement('div');
            div.className = 'outline-item level-' + h.level;
            div.textContent = h.text;
            div.onclick = () => {
                const viewer = $('#viewer');
                if (!viewer) return;
                const allHeadings = viewer.querySelectorAll('h1, h2, h3');
                for (const el of allHeadings) {
                    if (el.textContent.trim() === h.text) {
                        el.scrollIntoView({ behavior: 'smooth', block: 'start' });
                        break;
                    }
                }
                if (window.innerWidth < 768) showPanel('view');
            };
            list.appendChild(div);
        }
    }

    // --- Navigation ---

    function getHashNote() {
        return location.hash.slice(1) || null;
    }

    function navigateTo(name) {
        if (editMode) saveCurrentEdit();
        editMode = false;
        currentNote = name;
        location.hash = name;
        renderNoteList();
        if (isMobile()) {
            openMobileNote(name);
        } else {
            renderNote();
        }
    }

    // --- Edit ---

    function toggleEdit() {
        if (isMobile()) return;
        if (editMode) {
            saveCurrentEdit();
            editMode = false;
        } else {
            editMode = true;
        }
        renderNote();
    }

    function saveCurrentEdit() {
        if (!currentNote) return;
        const textarea = $('#panel-edit textarea');
        if (textarea) {
            notes[currentNote] = textarea.value;
            touchMeta(currentNote);
            saveNotes();
            renderFilterBar();
        }
    }

    // --- Note Management ---

    function showNewNoteModal() {
        $('#new-note-modal').classList.add('visible');
        const input = $('#new-note-name');
        input.value = '';
        renderTemplateList();
        setTimeout(() => input.focus(), 100);
    }

    let selectedTemplate = 'empty';

    function renderTemplateList() {
        const container = $('#template-list');
        if (!container) return;
        container.innerHTML = '';
        for (const t of TEMPLATES) {
            const div = document.createElement('div');
            div.className = 'template-item' + (selectedTemplate === t.id ? ' selected' : '');
            div.innerHTML = '<div class="template-name">' + t.name + '</div><div class="template-desc">' + t.desc + '</div>';
            div.onclick = () => {
                selectedTemplate = t.id;
                renderTemplateList();
            };
            container.appendChild(div);
        }
    }

    function confirmCreateNote() {
        const input = $('#new-note-name');
        const rawName = input.value.trim();
        if (!rawName) return;
        const name = slugify(rawName);
        if (!name) return;

        if (notes[name]) {
            navigateTo(name);
        } else {
            const template = TEMPLATES.find(t => t.id === selectedTemplate) || TEMPLATES[0];
            const today = formatDate(new Date());
            notes[name] = template.content
                .replace(/\{\{title\}\}/g, rawName)
                .replace(/\{\{date\}\}/g, today);
            getMeta(name);
            saveNotes();
            renderFilterBar();
            renderNoteList();
            navigateTo(name);
        }
        $('#new-note-modal').classList.remove('visible');
        showPanel('view');
        selectedTemplate = 'empty';
    }

    function deleteNote(name) {
        if (!confirm('Notiz "' + name + '" wirklich löschen?')) return;
        delete notes[name];
        delete meta[name];
        saveNotes();
        if (currentNote === name) navigateTo(DEFAULT_NOTE);
        renderFilterBar();
        renderNoteList();
    }

    function exportZip() {
        const zip = new JSZip();
        for (const [name, content] of Object.entries(notes)) {
            zip.file(name + '.md', content);
        }
        const metaExport = JSON.stringify(meta, null, 2);
        zip.file('_meta.json', metaExport);
        zip.generateAsync({ type: 'blob' }).then(blob => {
            const a = document.createElement('a');
            a.href = URL.createObjectURL(blob);
            a.download = 'minivault-export.zip';
            a.click();
            URL.revokeObjectURL(a.href);
        });
    }

    // --- Project Modal ---

    function showProjectModal() {
        $('#project-modal').classList.add('visible');
        const input = $('#project-name-input');
        const m = getMeta(currentNote);
        input.value = m.project || '';

        const existing = $('#existing-projects');
        existing.innerHTML = '';
        for (const p of getAllProjects()) {
            const div = document.createElement('div');
            div.className = 'template-item' + (m.project === p ? ' selected' : '');
            div.innerHTML = '<div class="template-name">📁 ' + p + '</div>';
            div.onclick = () => {
                input.value = p;
                assignProject(currentNote, p);
                $('#project-modal').classList.remove('visible');
                renderNote();
                renderFilterBar();
                renderNoteList();
                showToast('Projekt: ' + p);
            };
            existing.appendChild(div);
        }

        setTimeout(() => input.focus(), 100);
    }

    function confirmProjectAssign() {
        const input = $('#project-name-input');
        const name = input.value.trim();
        assignProject(currentNote, name);
        $('#project-modal').classList.remove('visible');
        renderNote();
        renderFilterBar();
        renderNoteList();
        if (name) showToast('Projekt: ' + name);
    }

    // --- Toast ---

    function showToast(msg) {
        const toast = $('#toast');
        toast.textContent = msg;
        toast.classList.add('visible');
        setTimeout(() => toast.classList.remove('visible'), 2500);
    }

    // --- Graph ---

    function showGraph() {
        $('#graph-overlay').style.display = 'block';
        renderGraph();
    }

    function hideGraph() {
        $('#graph-overlay').style.display = 'none';
        const svg = $('#graph-container svg');
        if (svg) svg.remove();
    }

    function renderGraph() {
        const container = $('#graph-container');
        const width = container.clientWidth;
        const height = container.clientHeight;

        const nodeNames = Object.keys(notes);
        const nodeMap = {};
        const nodes = nodeNames.map((name, i) => {
            const node = { id: name, index: i, project: getMeta(name).project };
            nodeMap[name] = node;
            return node;
        });

        const links = [];
        const seen = new Set();
        for (const [name, content] of Object.entries(notes)) {
            if (!content) continue;
            const matches = content.match(/\[\[([^\]]+)\]\]/g) || [];
            for (const m of matches) {
                const target = slugify(m.slice(2, -2));
                if (nodeMap[target] && name !== target) {
                    const key = [name, target].sort().join('|');
                    if (!seen.has(key)) {
                        seen.add(key);
                        links.push({ source: nodeMap[name], target: nodeMap[target] });
                    }
                }
            }
        }

        const projectColors = {};
        const palette = ['#e94560', '#53a8e2', '#c084fc', '#4ade80', '#fbbf24', '#f472b6', '#818cf8'];
        let ci = 0;
        for (const n of nodes) {
            if (n.project && !projectColors[n.project]) {
                projectColors[n.project] = palette[ci++ % palette.length];
            }
        }

        const svg = d3.select(container).append('svg').attr('width', width).attr('height', height);
        const simulation = d3.forceSimulation(nodes)
            .force('link', d3.forceLink(links).distance(100))
            .force('charge', d3.forceManyBody().strength(-200))
            .force('center', d3.forceCenter(width / 2, height / 2))
            .force('collision', d3.forceCollide().radius(35));

        const link = svg.append('g').selectAll('line').data(links).join('line')
            .attr('stroke', '#2a2a4a').attr('stroke-width', 1.5);

        const node = svg.append('g').selectAll('g').data(nodes).join('g')
            .style('cursor', 'pointer')
            .call(d3.drag()
                .on('start', (event, d) => { if (!event.active) simulation.alphaTarget(0.3).restart(); d.fx = d.x; d.fy = d.y; })
                .on('drag', (event, d) => { d.fx = event.x; d.fy = event.y; })
                .on('end', (event, d) => { if (!event.active) simulation.alphaTarget(0); d.fx = null; d.fy = null; }));

        node.append('circle')
            .attr('r', d => d.id === currentNote ? 10 : 7)
            .attr('fill', d => {
                if (d.id === currentNote) return '#e94560';
                if (d.project && projectColors[d.project]) return projectColors[d.project];
                return '#53a8e2';
            });

        node.append('text').text(d => d.id).attr('dx', 14).attr('dy', 4).attr('fill', '#a0a0b0').attr('font-size', '12px');

        node.on('click', (event, d) => { hideGraph(); navigateTo(d.id); showPanel('view'); });

        simulation.on('tick', () => {
            link.attr('x1', d => d.source.x).attr('y1', d => d.source.y).attr('x2', d => d.target.x).attr('y2', d => d.target.y);
            node.attr('transform', d => 'translate(' + d.x + ',' + d.y + ')');
        });
    }

    // --- Utilities ---

    function slugify(text) {
        return text.toLowerCase().trim()
            .replace(/\s+/g, '-')
            .replace(/[^a-z0-9äöüß\-]/g, '');
    }

    function formatDate(d) {
        return d.getFullYear() + '-' +
            String(d.getMonth() + 1).padStart(2, '0') + '-' +
            String(d.getDate()).padStart(2, '0');
    }

    // --- Gist Sync ---

    let syncInProgress = false;

    function getSyncToken() { return localStorage.getItem(SYNC_TOKEN_KEY) || ''; }
    function getSyncGistId() { return localStorage.getItem(SYNC_GIST_KEY) || ''; }

    function showSyncModal() {
        $('#sync-modal').classList.add('visible');
        $('#sync-token').value = getSyncToken();
        updateSyncStatusInfo();
    }

    function updateSyncStatusInfo() {
        const info = $('#sync-status-info');
        const gistId = getSyncGistId();
        const lastSync = localStorage.getItem(SYNC_LAST_KEY);
        const token = getSyncToken();
        if (!token) {
            info.innerHTML = '<span style="color:var(--text-muted)">Nicht verbunden</span>';
        } else if (gistId) {
            const lastStr = lastSync ? new Date(parseInt(lastSync)).toLocaleString('de-DE') : 'Nie';
            info.innerHTML = '<span style="color:#4ade80">Verbunden</span> · Letzter Sync: ' + lastStr;
        } else {
            info.innerHTML = '<span style="color:var(--tag-color)">Token gesetzt – noch nicht synchronisiert</span>';
        }
    }

    function saveSyncToken() {
        const token = $('#sync-token').value.trim();
        if (token) {
            localStorage.setItem(SYNC_TOKEN_KEY, token);
            showToast('Token gespeichert');
        } else {
            localStorage.removeItem(SYNC_TOKEN_KEY);
        }
        updateSyncStatusInfo();
    }

    function disconnectSync() {
        if (!confirm('Sync trennen? Lokale Daten bleiben erhalten.')) return;
        localStorage.removeItem(SYNC_TOKEN_KEY);
        localStorage.removeItem(SYNC_GIST_KEY);
        localStorage.removeItem(SYNC_LAST_KEY);
        $('#sync-token').value = '';
        updateSyncStatusInfo();
        updateSyncIndicator();
        showToast('Sync getrennt');
    }

    async function gistApiRequest(method, url, body) {
        const token = getSyncToken();
        if (!token) throw new Error('Kein GitHub-Token gesetzt');
        const opts = {
            method: method,
            headers: {
                'Authorization': 'token ' + token,
                'Accept': 'application/vnd.github.v3+json'
            }
        };
        if (body) {
            opts.headers['Content-Type'] = 'application/json';
            opts.body = JSON.stringify(body);
        }
        const resp = await fetch('https://api.github.com' + url, opts);
        if (!resp.ok) {
            const err = await resp.text();
            throw new Error('GitHub API Fehler ' + resp.status + ': ' + err);
        }
        return resp.json();
    }

    function buildGistPayload() {
        return {
            description: 'MiniVault Sync – Nicht manuell bearbeiten',
            public: false,
            files: {
                'minivault_notes.json': { content: JSON.stringify(notes, null, 2) },
                'minivault_meta.json': { content: JSON.stringify(meta, null, 2) },
                'minivault_projects.json': { content: JSON.stringify(projects, null, 2) }
            }
        };
    }

    function mergeData(remoteNotes, remoteMeta, remoteProjects) {
        let changed = false;

        for (const [name, content] of Object.entries(remoteNotes)) {
            if (!notes[name]) {
                notes[name] = content;
                if (remoteMeta[name]) meta[name] = remoteMeta[name];
                else getMeta(name);
                changed = true;
            } else {
                const localMod = (meta[name] && meta[name].modified) || 0;
                const remoteMod = (remoteMeta[name] && remoteMeta[name].modified) || 0;
                if (remoteMod > localMod) {
                    notes[name] = content;
                    meta[name] = remoteMeta[name];
                    changed = true;
                }
            }
        }

        for (const [name, content] of Object.entries(notes)) {
            if (!remoteNotes[name]) {
                changed = true;
            }
        }

        if (remoteProjects && remoteProjects.length) {
            for (const p of remoteProjects) {
                if (!projects.includes(p)) {
                    projects.push(p);
                    changed = true;
                }
            }
        }

        return changed;
    }

    async function syncNow() {
        if (syncInProgress) return;
        const token = getSyncToken();
        if (!token) {
            showSyncModal();
            return;
        }

        syncInProgress = true;
        updateSyncIndicator('syncing');

        try {
            const gistId = getSyncGistId();

            if (gistId) {
                let remoteGist;
                try {
                    remoteGist = await gistApiRequest('GET', '/gists/' + gistId);
                } catch (e) {
                    localStorage.removeItem(SYNC_GIST_KEY);
                    await createNewGist();
                    return;
                }

                const remoteNotes = JSON.parse(remoteGist.files['minivault_notes.json'].content);
                const remoteMeta = JSON.parse(remoteGist.files['minivault_meta.json'].content);
                const remoteProjects = JSON.parse(remoteGist.files['minivault_projects.json'].content);

                mergeData(remoteNotes, remoteMeta, remoteProjects);

                saveNotes();
                saveProjects();

                await gistApiRequest('PATCH', '/gists/' + gistId, {
                    files: {
                        'minivault_notes.json': { content: JSON.stringify(notes, null, 2) },
                        'minivault_meta.json': { content: JSON.stringify(meta, null, 2) },
                        'minivault_projects.json': { content: JSON.stringify(projects, null, 2) }
                    }
                });
            } else {
                await createNewGist();
            }

            localStorage.setItem(SYNC_LAST_KEY, String(Date.now()));
            updateSyncStatusInfo();
            renderFilterBar();
            renderNoteList();
            if (currentNote) renderNote();
            updateSyncIndicator('done');
            showToast('Sync erfolgreich');
        } catch (e) {
            console.error('Sync error:', e);
            updateSyncIndicator('error');
            showToast('Sync-Fehler: ' + e.message);
        } finally {
            syncInProgress = false;
        }
    }

    async function createNewGist() {
        const gist = await gistApiRequest('POST', '/gists', buildGistPayload());
        localStorage.setItem(SYNC_GIST_KEY, gist.id);
    }

    function updateSyncIndicator(state) {
        const btn = $('#btn-sync');
        if (!btn) return;
        if (state === 'syncing') {
            btn.textContent = '⏳';
            btn.classList.add('syncing');
        } else if (state === 'error') {
            btn.textContent = '⚠️';
            btn.classList.remove('syncing');
            setTimeout(() => { btn.textContent = '🔄'; }, 3000);
        } else if (state === 'done') {
            btn.textContent = '✅';
            btn.classList.remove('syncing');
            setTimeout(() => { btn.textContent = '🔄'; }, 2000);
        } else {
            btn.textContent = getSyncToken() ? '🔄' : '🔄';
            btn.classList.remove('syncing');
        }
    }

    async function autoSync() {
        if (!getSyncToken() || !getSyncGistId()) return;
        const last = parseInt(localStorage.getItem(SYNC_LAST_KEY) || '0');
        if (Date.now() - last > 30000) {
            await syncNow();
        }
    }

    // --- Events ---

    function setupEventListeners() {
        // Bottom nav
        $('#nav-notes').onclick = () => {
            if (isMobile() && currentNote) saveMobileNote();
            showPanel('notes');
        };
        $('#nav-view').onclick = () => {
            if (isMobile() && currentNote) openMobileNote(currentNote);
            else showPanel('view');
        };
        $('#nav-backlinks').onclick = () => showPanel('backlinks');
        $('#nav-outline').onclick = () => showPanel('outline');
        $('#nav-graph').onclick = showGraph;

        // Mobile note toolbar
        $('#btn-mobile-back').onclick = () => {
            saveMobileNote();
            showPanel('notes');
        };
        $('#btn-mobile-save').onclick = saveMobileNote;
        $('#btn-mobile-preview').onclick = toggleMobilePreview;

        // Mobile textarea auto-save
        $('#mobile-textarea').addEventListener('input', () => {
            if (currentNote) {
                notes[currentNote] = $('#mobile-textarea').value;
                touchMeta(currentNote);
                saveNotes();
            }
        });

        // List actions
        $('#btn-new').onclick = showNewNoteModal;
        $('#btn-daily').onclick = createDailyNote;
        $('#btn-export').onclick = exportZip;

        // Search
        $('#search-box').oninput = (e) => renderNoteList(e.target.value);

        // Sort
        $('#sort-select').onchange = (e) => {
            sortMode = e.target.value;
            localStorage.setItem(SORT_KEY, sortMode);
            renderNoteList();
        };

        // New note modal
        $('#btn-create-confirm').onclick = confirmCreateNote;
        $('#btn-create-cancel').onclick = () => { $('#new-note-modal').classList.remove('visible'); selectedTemplate = 'empty'; };
        $('#new-note-name').onkeydown = (e) => {
            if (e.key === 'Enter') confirmCreateNote();
            if (e.key === 'Escape') { $('#new-note-modal').classList.remove('visible'); selectedTemplate = 'empty'; }
        };

        // Project modal
        $('#btn-project-confirm').onclick = confirmProjectAssign;
        $('#btn-project-cancel').onclick = () => $('#project-modal').classList.remove('visible');
        $('#btn-project-remove').onclick = () => {
            assignProject(currentNote, null);
            $('#project-modal').classList.remove('visible');
            renderNote();
            renderFilterBar();
            renderNoteList();
            showToast('Projekt entfernt');
        };
        $('#project-name-input').onkeydown = (e) => {
            if (e.key === 'Enter') confirmProjectAssign();
            if (e.key === 'Escape') $('#project-modal').classList.remove('visible');
        };

        // Sync
        $('#btn-sync').onclick = showSyncModal;
        $('#btn-sync-save').onclick = () => { saveSyncToken(); $('#sync-modal').classList.remove('visible'); };
        $('#btn-sync-cancel').onclick = () => $('#sync-modal').classList.remove('visible');
        $('#btn-sync-now').onclick = () => { $('#sync-modal').classList.remove('visible'); syncNow(); };
        $('#btn-sync-disconnect').onclick = disconnectSync;

        // Graph
        $('#graph-close').onclick = hideGraph;

        // Desktop toolbar
        const dtEdit = $('#btn-edit-desktop');
        if (dtEdit) dtEdit.onclick = toggleEdit;
        const dtGraph = $('#btn-graph-desktop');
        if (dtGraph) dtGraph.onclick = showGraph;

        // Hash
        window.addEventListener('hashchange', () => {
            const name = getHashNote();
            if (name && name !== currentNote) navigateTo(name);
        });

        // Keyboard
        document.addEventListener('keydown', (e) => {
            if (e.ctrlKey && e.key === 'e') { e.preventDefault(); toggleEdit(); }
            if (e.key === 'Escape') {
                if ($('#graph-overlay').style.display === 'block') hideGraph();
                $$('.modal-overlay.visible').forEach(m => m.classList.remove('visible'));
            }
        });

        // Auto-save
        $('#panel-edit textarea').addEventListener('input', () => {
            if (currentNote) {
                notes[currentNote] = $('#panel-edit textarea').value;
                touchMeta(currentNote);
                saveNotes();
            }
        });
    }

    // --- Start ---

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
