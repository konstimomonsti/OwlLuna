// What a search of the library finds: notebooks whose title or tags match, then pages whose words do.

import { Search } from "lucide-react";
import { EmptyPlate } from "../design/controls";
import { openNotebook, useApp } from "../state/app";
import type { SearchResults as Results } from "../services/search";
import { Cover } from "./Cover";

export function SearchResults(props: { results: Results | null; query: string }) {
  const manifests = useApp((state) => state.manifests);
  const { results } = props;
  if (!results) return <p className="meta" style={{ paddingTop: 16 }} data-testid="search-busy">Reading your notebooks…</p>;
  if (results.notebooks.length === 0 && results.pages.length === 0) {
    return (
      <EmptyPlate icon={<Search />} title="Nothing matches">
        Titles, tags, typed text, link labels, picture text and recognised handwriting were searched. Locked notebooks are left out.
      </EmptyPlate>
    );
  }
  return (
    <div className="search-results" data-testid="search-results">
      {results.notebooks.length > 0 && (
        <section>
          <h2>Notebooks</h2>
          <div>
            {results.notebooks.map((hit) => {
              const manifest = manifests[hit.id];
              return (
                <div key={hit.id} className="catalogue-row" data-testid="search-notebook">
                  <button type="button" className="catalogue-main" onClick={() => void openNotebook(hit.id)}>
                    {manifest && <Cover title={manifest.title} cover={manifest.cover} whiteboard={manifest.kind === "whiteboard"} manifest={manifest} locked={manifest.locked} />}
                    <span className="text"><span className="title">{hit.title}</span></span>
                  </button>
                </div>
              );
            })}
          </div>
        </section>
      )}
      {results.pages.length > 0 && (
        <section>
          <h2>Pages</h2>
          <div>
            {results.pages.map((hit) => (
              <button key={`${hit.notebook}:${hit.page}`} type="button" className="result-row" onClick={() => void openNotebook(hit.notebook, hit.page)} data-testid="search-page">
                <span className="where truncate">{hit.title} · page {hit.pageNumber}</span>
                <span className="snippet">
                  {hit.snippet.before}
                  {hit.snippet.match && <mark className="hit">{hit.snippet.match}</mark>}
                  {hit.snippet.after}
                </span>
              </button>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
