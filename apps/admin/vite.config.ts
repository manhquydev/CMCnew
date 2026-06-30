import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
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
    closeBundle() {
      const distDirectory = join(adminRoot, 'dist');
      const indexHtmlPath = join(distDirectory, 'index.html');
      const defaultHtml = renderHtmlForMetadata(readFileSync(indexHtmlPath, 'utf8'), ADMIN_DEFAULT_METADATA);
      writeFileSync(indexHtmlPath, defaultHtml);

      for (const route of ADMIN_ROUTE_METADATA) {
        const routeDirectory = join(distDirectory, route.path);
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
