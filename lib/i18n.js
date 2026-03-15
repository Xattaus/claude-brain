/**
 * i18n — Lokalisaatiomoduuli Brain MCP Serverille
 * 
 * Tukee: fi (suomi, oletus), en (englanti)
 * Kieli asetetaan manifest.json:issa: "language": "fi" | "en"
 */

const translations = {
    fi: {
        // Body section headers
        context: 'Konteksti',
        decision: 'Päätös',
        alternatives: 'Harkitut vaihtoehdot',
        consequences: 'Seuraukset',
        files: 'Tiedostot',
        validation: 'Validointi',
        symptoms: 'Oireet',
        root_cause: 'Juurisyy',
        fix: 'Korjaus',
        regression_test: 'Regressiotesti',
        description: 'Kuvaus',
        key_details: 'Avainparametrit',
        why: 'Miksi näin',
        pattern: 'Malli',
        example: 'Esimerkki',
        original_plan: 'Alkuperäinen suunnitelma',
        implemented: 'Toteutettu',
        deferred: 'Lykätty myöhemmäksi',
        next_steps: 'Seuraavat askeleet',
        not_implemented: '(ei vielä toteutettu)',
        not_deferred: '(ei lykättyjä)',
        not_defined: '(ei määritelty)',

        // Lesson sections
        what_happened: 'Mitä tapahtui',
        lesson: 'Oppi',
        rule: 'Sääntö',
        trigger_label: 'Lähde',

        // Overview sections
        active_decisions: 'Active Decisions',
        open_bugs: 'Open Bugs',
        health_warnings: 'Health Warnings',
        backlog: 'Backlog',
        project_locations: 'Projektisijainnit',

        // Changelog
        changelog_title: 'Muutoshistoria',

        // Health report
        total_entries: 'Total entries',
        entries_by_type: 'Entries by type',
        entries_by_status: 'Entries by status',

        // Hook messages
        hook_session_start: '🧠 BRAIN ACTIVE — Muista:\n1. Kutsu brain_get_overview saadaksesi projektin yleiskuvan\n2. Kutsu brain_get_backlog nähdäksesi keskeneräiset suunnitelmat\n3. Käytä brain_check_conflicts ENNEN muutoksia\n4. Tallenna päätökset, bugit ja toteutukset aivoihin',
        hook_stop: '🧠 Ennen lopettamista: Tarkista oletko tallentanut istunnon aikana tehdyt muutokset brain-merkinnöiksi.',
        hook_pre_tool: '🧠 BRAIN: Muokkaat tiedostoa "{file}". Oletko kutsunut brain_get_context_for_files ja brain_check_conflicts tälle tiedostolle?',
        hook_post_tool: '🧠 BRAIN: Muokkasit tiedostoa "{file}". Oliko tämä merkittävä muutos? Harkitse tallentamista brain-merkintänä.',
    },
    en: {
        // Body section headers
        context: 'Context',
        decision: 'Decision',
        alternatives: 'Considered Alternatives',
        consequences: 'Consequences',
        files: 'Files',
        validation: 'Validation',
        symptoms: 'Symptoms',
        root_cause: 'Root Cause',
        fix: 'Fix',
        regression_test: 'Regression Test',
        description: 'Description',
        key_details: 'Key Details',
        why: 'Why This Approach',
        pattern: 'Pattern',
        example: 'Example',
        original_plan: 'Original Plan',
        implemented: 'Implemented',
        deferred: 'Deferred',
        next_steps: 'Next Steps',
        not_implemented: '(not yet implemented)',
        not_deferred: '(none deferred)',
        not_defined: '(not defined)',

        // Lesson sections
        what_happened: 'What Happened',
        lesson: 'Lesson',
        rule: 'Rule',
        trigger_label: 'Source',

        // Overview sections
        active_decisions: 'Active Decisions',
        open_bugs: 'Open Bugs',
        health_warnings: 'Health Warnings',
        backlog: 'Backlog',
        project_locations: 'Project Locations',

        // Changelog
        changelog_title: 'Change History',

        // Health report
        total_entries: 'Total entries',
        entries_by_type: 'Entries by type',
        entries_by_status: 'Entries by status',

        // Hook messages
        hook_session_start: '🧠 BRAIN ACTIVE — Remember:\n1. Call brain_get_overview for project overview\n2. Call brain_get_backlog for incomplete plans\n3. Use brain_check_conflicts BEFORE changes\n4. Save decisions, bugs and implementations to brain',
        hook_stop: '🧠 Before stopping: Check if you have saved session changes as brain entries.',
        hook_pre_tool: '🧠 BRAIN: Modifying "{file}". Have you called brain_get_context_for_files and brain_check_conflicts for this file?',
        hook_post_tool: '🧠 BRAIN: Modified "{file}". Was this a significant change? Consider saving as a brain entry.',
    }
};

/**
 * Get translation function for a given language
 * @param {string} lang - Language code ('fi' or 'en')
 * @returns {function} Translation function: t(key, params?) => string
 */
export function getTranslator(lang = 'fi') {
    const strings = translations[lang] || translations.fi;

    return function t(key, params = {}) {
        let text = strings[key] || translations.fi[key] || key;
        // Replace {param} placeholders
        for (const [k, v] of Object.entries(params)) {
            text = text.replace(`{${k}}`, v);
        }
        return text;
    };
}

export { translations };
