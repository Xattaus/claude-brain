/**
 * Brain Metrics — Usage tracking for Brain MCP Server
 * 
 * Tracks tool calls, entry creation, search queries, and session statistics.
 * Data is stored in .brain/metrics.json and accumulates over time.
 */

import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { existsSync } from 'node:fs';

export class BrainMetrics {
    constructor(brainPath) {
        this.metricsPath = join(brainPath, 'metrics.json');
        this._data = null;
    }

    async load() {
        if (this._data) return this._data;
        try {
            const raw = await readFile(this.metricsPath, 'utf-8');
            this._data = JSON.parse(raw);
        } catch {
            this._data = this._defaultData();
        }
        return this._data;
    }

    async save() {
        if (!this._data) return;
        await writeFile(this.metricsPath, JSON.stringify(this._data, null, 2), 'utf-8');
    }

    _defaultData() {
        return {
            version: 1,
            created: new Date().toISOString(),
            totalCalls: 0,
            callsByTool: {},
            callsByDay: {},
            entriesCreated: { total: 0, byType: {} },
            searchQueries: [],
            sessions: []
        };
    }

    /**
     * Track a tool call
     */
    async trackCall(toolName) {
        const data = await this.load();
        data.totalCalls++;
        data.callsByTool[toolName] = (data.callsByTool[toolName] || 0) + 1;

        const today = new Date().toISOString().substring(0, 10);
        if (!data.callsByDay[today]) data.callsByDay[today] = {};
        data.callsByDay[today][toolName] = (data.callsByDay[today][toolName] || 0) + 1;

        await this.save();
    }

    /**
     * Track an entry creation
     */
    async trackEntryCreated(type) {
        const data = await this.load();
        data.entriesCreated.total++;
        data.entriesCreated.byType[type] = (data.entriesCreated.byType[type] || 0) + 1;
        await this.save();
    }

    /**
     * Track a search query
     */
    async trackSearch(query, resultsCount) {
        const data = await this.load();
        data.searchQueries.push({
            query,
            results: resultsCount,
            timestamp: new Date().toISOString()
        });
        // Keep only last 100 searches
        if (data.searchQueries.length > 100) {
            data.searchQueries = data.searchQueries.slice(-100);
        }
        await this.save();
    }

    /**
     * Start a session tracking
     */
    async trackSessionStart() {
        const data = await this.load();
        data.sessions.push({
            start: new Date().toISOString(),
            end: null,
            calls: 0,
            entriesCreated: 0
        });
        // Keep only last 50 sessions
        if (data.sessions.length > 50) {
            data.sessions = data.sessions.slice(-50);
        }
        await this.save();
    }

    /**
     * Get a formatted metrics report
     */
    async getReport() {
        const data = await this.load();
        const today = new Date().toISOString().substring(0, 10);
        const todayCalls = data.callsByDay[today] || {};
        const todayTotal = Object.values(todayCalls).reduce((a, b) => a + b, 0);

        let report = `## Brain Metrics\n\n`;
        report += `**Total tool calls:** ${data.totalCalls}\n`;
        report += `**Today's calls:** ${todayTotal}\n`;
        report += `**Total entries created:** ${data.entriesCreated.total}\n\n`;

        // Top tools
        const sortedTools = Object.entries(data.callsByTool)
            .sort(([, a], [, b]) => b - a)
            .slice(0, 10);
        if (sortedTools.length > 0) {
            report += `### Most Used Tools\n`;
            for (const [tool, count] of sortedTools) {
                const bar = '█'.repeat(Math.min(Math.round(count / Math.max(...Object.values(data.callsByTool)) * 20), 20));
                report += `- \`${tool}\`: ${count} ${bar}\n`;
            }
            report += '\n';
        }

        // Entries by type
        const byType = data.entriesCreated.byType;
        if (Object.keys(byType).length > 0) {
            report += `### Entries by Type\n`;
            for (const [type, count] of Object.entries(byType)) {
                report += `- ${type}: ${count}\n`;
            }
            report += '\n';
        }

        // Recent searches
        const recentSearches = data.searchQueries.slice(-5);
        if (recentSearches.length > 0) {
            report += `### Recent Searches\n`;
            for (const s of recentSearches) {
                report += `- "${s.query}" → ${s.results} results\n`;
            }
            report += '\n';
        }

        // Activity by day (last 7 days)
        const days = Object.keys(data.callsByDay).sort().slice(-7);
        if (days.length > 0) {
            report += `### Activity (Last 7 Days)\n`;
            for (const day of days) {
                const total = Object.values(data.callsByDay[day]).reduce((a, b) => a + b, 0);
                const bar = '█'.repeat(Math.min(Math.round(total / 5), 30));
                report += `- ${day}: ${total} calls ${bar}\n`;
            }
            report += '\n';
        }

        return report;
    }
}
