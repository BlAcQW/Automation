import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { productNavigation, productTabs, serviceNavigation, serviceTabs } from './nav-items';

const APP_DIR = fileURLToPath(new URL('../../app/', import.meta.url));

const linkedPages = [...serviceNavigation, ...productNavigation, ...serviceTabs, ...productTabs]
    .map((item) => item.href)
    .filter((href, index, all) => all.indexOf(href) === index);

describe('pages linked from the sidebar', () => {
    // A page without this layout opens with no sidebar, so the owner is stuck on
    // it (this happened to /channels and /money).
    it.each(linkedPages)('%s is wrapped in the dashboard shell by its layout', (href) => {
        // Arrange
        const layout = `${APP_DIR}${href.slice(1)}/layout.tsx`;

        // Act
        const source = existsSync(layout) ? readFileSync(layout, 'utf8') : '';

        // Assert
        expect(source, `${layout} is missing or does not render <DashboardShell>`).toContain('<DashboardShell>');
    });
});
