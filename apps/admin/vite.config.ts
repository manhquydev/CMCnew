import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import {
  ADMIN_DEFAULT_METADATA,
  ADMIN_ROUTE_METADATA,
  type LinkPreviewMetadata,
} from './src/link-preview-metadata';

const adminRoot = fileURLToPath(new URL('.', import.meta.url));

function escapeHtml(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function replaceMetaContent(html: string, selector: string, content: string) {
  const escapedContent = escapeHtml(content);
  const metaPattern = new RegExp(`(<meta(?=[^>]*${escapeRegExp(selector)})[^>]*content=")[^"]*("[^>]*>)`, 'm');
  return html.replace(metaPattern, `$1${escapedContent}$2`);
}

function renderHtmlForMetadata(html: string, metadata: LinkPreviewMetadata) {
  let renderedHtml = html.replace(/<title>.*<\/title>/, `<title>${escapeHtml(metadata.title)}</title>`);
  renderedHtml = replaceMetaContent(renderedHtml, 'name="description"', metadata.description);
  renderedHtml = replaceMetaContent(renderedHtml, 'property="og:title"', metadata.title);
  renderedHtml = replaceMetaContent(renderedHtml, 'property="og:description"', metadata.description);
  renderedHtml = replaceMetaContent(renderedHtml, 'name="twitter:title"', metadata.title);
  renderedHtml = replaceMetaContent(renderedHtml, 'name="twitter:description"', metadata.description);
  return renderedHtml;
}

function adminRouteMetadataPlugin(): Plugin {
  return {
    name: 'admin-route-metadata',
    apply: 'build',
    // writeBundle fires after Rollup writes all files to disk — avoids the race where
    // closeBundle (hookParallel) runs concurrently with Vite's own HTML-write plugin and
    // reads dist/index.html before it exists (ENOENT on low-resource builds).
    writeBundle(options) {
      const distDirectory = options.dir ?? join(adminRoot, 'dist');
      const indexHtmlPath = join(distDirectory, 'index.html');
      // Non-client environments (e.g. SSR) don't produce index.html — skip silently.
      if (!existsSync(indexHtmlPath)) return;
      const defaultHtml = renderHtmlForMetadata(readFileSync(indexHtmlPath, 'utf8'), ADMIN_DEFAULT_METADATA);
      writeFileSync(indexHtmlPath, defaultHtml);

      for (const route of ADMIN_ROUTE_METADATA) {
        const routeDirectory = join(distDirectory, route.path);  // route.path = '/login', '/app', etc.
        mkdirSync(routeDirectory, { recursive: true });
        writeFileSync(join(routeDirectory, 'index.html'), renderHtmlForMetadata(defaultHtml, route.metadata));
      }
    },
  };
}

export default defineConfig({
  plugins: [react(), adminRouteMetadataPlugin()],
  server: { port: 5173 },
});
