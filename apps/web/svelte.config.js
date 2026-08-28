import adapter from '@sveltejs/adapter-static';
export default {
  kit: {
    adapter: adapter({ fallback: 'index.html' }),
    // Client-rendered: every page talks to the local core, and there is no
    // server-side render because the server cannot read anything anyway.
    prerender: { entries: [] },
  },
};
