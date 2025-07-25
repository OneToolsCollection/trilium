"use strict";

import type BNote from "../../../becca/entities/bnote.js";
import type SearchContext from "../search_context.js";

import Expression from "./expression.js";
import NoteSet from "../note_set.js";
import becca from "../../../becca/becca.js";
import { normalize } from "../../utils.js";
import beccaService from "../../../becca/becca_service.js";

class NoteFlatTextExp extends Expression {
    tokens: string[];

    constructor(tokens: string[]) {
        super();

        this.tokens = tokens;
    }

    execute(inputNoteSet: NoteSet, executionContext: any, searchContext: SearchContext) {
        const resultNoteSet = new NoteSet();

        /**
         * @param note
         * @param remainingTokens - tokens still needed to be found in the path towards root
         * @param takenPath - path so far taken towards from candidate note towards the root.
         *                    It contains the suffix fragment of the full note path.
         */
        const searchPathTowardsRoot = (note: BNote, remainingTokens: string[], takenPath: string[]) => {
            if (remainingTokens.length === 0) {
                // we're done, just build the result
                const resultPath = this.getNotePath(note, takenPath);

                if (resultPath) {
                    const noteId = resultPath[resultPath.length - 1];

                    if (!resultNoteSet.hasNoteId(noteId)) {
                        // we could get here from multiple paths, the first one wins because the paths
                        // are sorted by importance
                        executionContext.noteIdToNotePath[noteId] = resultPath;

                        resultNoteSet.add(becca.notes[noteId]);
                    }
                }

                return;
            }

            if (note.parents.length === 0 || note.noteId === "root") {
                // we've reached root, but there are still remaining tokens -> this candidate note produced no result
                return;
            }

            const foundAttrTokens: string[] = [];

            for (const token of remainingTokens) {
                if (note.type.includes(token) || note.mime.includes(token)) {
                    foundAttrTokens.push(token);
                }
            }

            for (const attribute of note.getOwnedAttributes()) {
                const normalizedName = normalize(attribute.name);
                const normalizedValue = normalize(attribute.value);

                for (const token of remainingTokens) {
                    if (normalizedName.includes(token) || normalizedValue.includes(token)) {
                        foundAttrTokens.push(token);
                    }
                }
            }

            for (const parentNote of note.parents) {
                const title = normalize(beccaService.getNoteTitle(note.noteId, parentNote.noteId));
                const foundTokens: string[] = foundAttrTokens.slice();

                for (const token of remainingTokens) {
                    if (title.includes(token)) {
                        foundTokens.push(token);
                    }
                }

                if (foundTokens.length > 0) {
                    const newRemainingTokens = remainingTokens.filter((token) => !foundTokens.includes(token));

                    searchPathTowardsRoot(parentNote, newRemainingTokens, [note.noteId, ...takenPath]);
                } else {
                    searchPathTowardsRoot(parentNote, remainingTokens, [note.noteId, ...takenPath]);
                }
            }
        };

        const candidateNotes = this.getCandidateNotes(inputNoteSet);

        for (const note of candidateNotes) {
            // autocomplete should be able to find notes by their noteIds as well (only leafs)
            if (this.tokens.length === 1 && note.noteId.toLowerCase() === this.tokens[0]) {
                searchPathTowardsRoot(note, [], [note.noteId]);
                continue;
            }

            const foundAttrTokens: string[] = [];

            for (const token of this.tokens) {
                if (note.type.includes(token) || note.mime.includes(token)) {
                    foundAttrTokens.push(token);
                }

                for (const attribute of note.ownedAttributes) {
                    if (normalize(attribute.name).includes(token) || normalize(attribute.value).includes(token)) {
                        foundAttrTokens.push(token);
                    }
                }
            }

            for (const parentNote of note.parents) {
                const title = normalize(beccaService.getNoteTitle(note.noteId, parentNote.noteId));
                const foundTokens = foundAttrTokens.slice();

                for (const token of this.tokens) {
                    if (title.includes(token)) {
                        foundTokens.push(token);
                    }
                }

                if (foundTokens.length > 0) {
                    const remainingTokens = this.tokens.filter((token) => !foundTokens.includes(token));

                    searchPathTowardsRoot(parentNote, remainingTokens, [note.noteId]);
                }
            }
        }

        return resultNoteSet;
    }

    getNotePath(note: BNote, takenPath: string[]): string[] {
        if (takenPath.length === 0) {
            throw new Error("Path is not expected to be empty.");
        } else if (takenPath.length === 1 && takenPath[0] === note.noteId) {
            return note.getBestNotePath();
        } else {
            // this note is the closest to root containing the last matching token(s), thus completing the requirements
            // what's in this note's predecessors does not matter, thus we'll choose the best note path
            const topMostMatchingTokenNotePath = becca.getNote(takenPath[0])?.getBestNotePath() || [];

            return [...topMostMatchingTokenNotePath, ...takenPath.slice(1)];
        }
    }

    /**
     * Returns noteIds which have at least one matching tokens
     */
    getCandidateNotes(noteSet: NoteSet): BNote[] {
        const candidateNotes: BNote[] = [];

        for (const note of noteSet.notes) {
            for (const token of this.tokens) {
                if (note.getFlatText().includes(token)) {
                    candidateNotes.push(note);
                    break;
                }
            }
        }

        return candidateNotes;
    }
}

export default NoteFlatTextExp;
