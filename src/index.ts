import joplin from 'api';
import { ContentScriptType, SettingItemType } from 'api/types';
import { logger } from './logger';

const CONTENT_SCRIPT_ID = 'headingLevels.codeMirror';
const SETTING_SECTION = 'headingLevels';
const SETTING_GUTTER_PLACEMENT = 'gutterPlacement';

type GutterPlacement = 'before' | 'after';

async function getGutterPlacement(): Promise<GutterPlacement> {
    const values = await joplin.settings.values(SETTING_GUTTER_PLACEMENT);
    return values[SETTING_GUTTER_PLACEMENT] === 'before' ? 'before' : 'after';
}

async function pushConfigUpdate(): Promise<void> {
    try {
        const gutterPlacement = await getGutterPlacement();
        await joplin.commands.execute('editor.execCommand', {
            name: 'headingLevels__setConfig',
            args: [{ gutterPlacement }],
        });
    } catch (e) {
        logger.warn('Could not push config update to editor.', e);
    }
}

joplin.plugins
    .register({
        onStart: async function () {
            // Register settings section
            await joplin.settings.registerSection(SETTING_SECTION, {
                label: 'Heading Levels',
                iconName: 'fas fa-heading',
            });

            // Register plugin settings
            await joplin.settings.registerSettings({
                [SETTING_GUTTER_PLACEMENT]: {
                    value: 'after',
                    type: SettingItemType.String,
                    section: SETTING_SECTION,
                    public: true,
                    label: 'Gutter position',
                    description: 'Display the heading level gutter before or after the line numbers.',
                    isEnum: true,
                    options: {
                        before: 'Before line numbers',
                        after: 'After line numbers',
                    },
                },
            });

            // Register the CodeMirror 6 content script
            await joplin.contentScripts.register(
                ContentScriptType.CodeMirrorPlugin,
                CONTENT_SCRIPT_ID,
                './contentScripts/codeMirror/contentScript.js'
            );

            // Respond to config requests from the content script
            await joplin.contentScripts.onMessage(CONTENT_SCRIPT_ID, async (message: { type: string }) => {
                if (message.type === 'getSettings') {
                    return { gutterPlacement: await getGutterPlacement() };
                }
            });

            // Push live config updates into the active editor when settings change
            await joplin.settings.onChange((event) => {
                if (event.keys.includes(SETTING_GUTTER_PLACEMENT)) {
                    void pushConfigUpdate();
                }
            });

            logger.info('Plugin started.');
        },
    })
    .catch((e) => logger.error('Plugin registration failed.', e));
