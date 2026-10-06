import type { Source } from "../types";

/** Every way a source can enter a space goes through one of these, so cloud connectors plug in later. */
export interface Importer<I> {
  id: string;
  canHandle(input: I): boolean;
  import(spaceId: string, input: I): Promise<Source>;
}
