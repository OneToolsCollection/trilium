import libraryLoader from "../../services/library_loader.js";
import TypeWidget from "./type_widget.js";
import appContext from "../../services/app_context.js";
import sleep from './canvas-note-utils/sleep.js';
import froca from "../../services/froca.js";
import debounce from "./canvas-note-utils/lodash.debounce.js";
import uniqueId from "./canvas-note-utils/lodash.uniqueId.js";


 // NoteContextAwareWidget does not handle loading/refreshing of note context
import NoteContextAwareWidget from "../note_context_aware_widget.js";

const TPL = `
    <div class="canvas-note-widget note-detail-canvas-note note-detail-printable">
        <style type="text/css">
        .note-detail-canvas-note {
            height: 100%;
        }

        .excalidraw .App-menu_top .buttonList {
            /*display: flex;*/
        }

        .excalidraw-wrapper {
            height: 100%;
            position: relative;
        }

        :root[dir="ltr"]
        .excalidraw
        .layer-ui__wrapper
        .zen-mode-transition.App-menu_bottom--transition-left {
            transform: none;
        }

        </style>
        <!-- height here necessary .otherwise excalidraw not shown. also, one window resize necessary! -->
        <div class="canvas-note-render" style="height: 500px"></div>
    </div>
`;

/**
 * FIXME: Buttons from one excalidraw get activated. Problems with instance?!
 * 
 * FIXME: when adding / removing splits, resize are not correctly called!!!
 */
export default class ExcalidrawTypeWidget extends TypeWidget {
    constructor() {
        super();

        // config
        this.debounceTimeOnchangeHandler = 750; // ms

        // temporary vars
        this.currentSceneVersion = -1;

        // will be overwritten
        this.excalidrawRef;
        this.$render;
        this.$renderElement;
        this.$widget;
        
        this.ExcalidrawReactApp = this.ExcalidrawReactApp.bind(this);
        this.doRefresh = this.doRefresh.bind(this);
        this.getContent = this.getContent.bind(this);
        this.saveData = this.saveData.bind(this);
        this.refreshWithNote = this.refreshWithNote.bind(this);
        this.onChangeHandler = this.onChangeHandler.bind(this);
        this.isNewSceneVersion = this.isNewSceneVersion.bind(this);
        this.updateSceneVersion = this.updateSceneVersion.bind(this);
        this.getSceneVersion = this.getSceneVersion.bind(this);
        this.test = this.test.bind(this);

        // debugging helper
        this.uniqueId = uniqueId();
        console.log("uniqueId", this.uniqueId);
        if (!window.triliumexcalidraw) {
            window.triliumexcalidraw = [];
        }
        window.triliumexcalidraw[this.uniqueId] = this;
        // end debug 
    }
    
    test() {
        /**
         * exportToSvg({
            elements: ExcalidrawElement[],
            appState: AppState,
            exportPadding?: number, = 10 defualt
            metadata?: string, // no function!?
            files?: BinaryFiles
            })
         */
        const elements = this.excalidrawRef.current.getSceneElements();
        const appState = this.excalidrawRef.current.getAppState();
        const files = this.excalidrawRef.current.getFiles();
        const data = {
            elements, 
            appState, 
            files, 
            exportPadding: 5, // padding [px] of svg "image"
        }
        const svg = window.Excalidraw.exportToSvg(data);

        console.log("test", data, svg);

        return svg;
    }

    static getType() {
        return "canvas-note";
    }

    log(...args) {
        let title = '';
        if (this.note) {
            title = this.note.title;
        } else {
            title = this.noteId + "nt/na";
        }

        console.log(title, "=", this.noteId, "==",  ...args);
    }

    doRender() {
        const self = this;
        this.$widget = $(TPL);

        this.contentSized();
        this.$render = this.$widget.find('.canvas-note-render');
        this.$renderElement = this.$render.get(0);
        this.log("doRender", this.$widget);

        libraryLoader
            .requireLibrary(libraryLoader.EXCALIDRAW)
            .then(() => {
                self.log("react, react-dom, excalidraw loaded");

                const React = window.React;
                const ReactDOM = window.ReactDOM;
                
                ReactDOM.unmountComponentAtNode(this.$renderElement);
                ReactDOM.render(React.createElement(this.ExcalidrawReactApp), self.$renderElement);

                // FIXME: probably, now, i should manually trigger a refresh?!
            })

        return this.$widget;
    }

    /**
     * called to populate the widget container with the note content
     * 
     * @param {note} note 
     */
    async doRefresh(note) {
        // get note from backend and put into canvas
        const noteComplement = await froca.getNoteComplement(note.noteId);
        this.log('doRefresh', note, noteComplement);

        /**
         * before we load content into excalidraw, make sure excalidraw has loaded
         * 
         * FIXME: better a loop?
         */
        if (!this.excalidrawRef) {
            this.log("doRefresh !!!!!!!!!!! excalidrawref not yet loeaded, sleep 1s...");
            await sleep(1000);
        }

        if (this.excalidrawRef.current && noteComplement.content) {
            const content = JSON.parse(noteComplement.content || "");
            const {elements, appState, files} = content;

            const sceneData = {
                elements, 
                appState,
                collaborators: []
            };

            // files are expected in an array when loading. they are stored as an key-index object
            // see example for loading here:
            // https://github.com/excalidraw/excalidraw/blob/c5a7723185f6ca05e0ceb0b0d45c4e3fbcb81b2a/src/packages/excalidraw/example/App.js#L68
            const fileArray = [];
            for (const fileId in files) {
                const file = files[fileId];
                // TODO: dataURL is replaceable with a trilium image url
                //       maybe we can save normal images (pasted) with base64 data url, and trilium images
                //       with their respective url! nice
                // file.dataURL = "http://localhost:8080/api/images/ltjOiU8nwoZx/start.png";
                fileArray.push(file);
            }

            this.log("doRefresh(note) sceneData, files", sceneData, files, fileArray);

            this.sceneVersion = window.Excalidraw.getSceneVersion(elements);
            this.log("doRefresh sceneVersion", window.Excalidraw.getSceneVersion(elements));

            this.excalidrawRef.current.updateScene(sceneData);
            this.excalidrawRef.current.addFiles(fileArray);

            // set initial version
            if (this.currentSceneVersion === -1) {
                this.currentSceneVersion = this.getSceneVersion();
            }
        }
    }

    /**
     * gets data from widget container that will be sent via spacedUpdate.scheduleUpdate();
     * this is automatically called after this.saveData();
     */
    getContent() {
        const time = new Date();

        const elements = this.excalidrawRef.current.getSceneElements();
        const appState = this.excalidrawRef.current.getAppState();
        /**
         * FIXME: a file is not deleted, even though removed from canvas
         *        maybe cross-reference elements and files before saving?!
         */
        const files = this.excalidrawRef.current.getFiles();

        const content = {
            elements,
            appState,
            files,
            time
        };

        this.log('getContent()', content);

        return JSON.stringify(content);
    }

    /**
     * save content to backend
     * spacedUpdate is kind of a debouncer.
     */
    saveData() {
        this.log("saveData()");
        this.spacedUpdate.scheduleUpdate();
    }


    /**
     * 
        // FIXME: also, after we save, a refresh is triggered. if we switch too fast, we might get the saved
        //        version instead of our (draw something, activate circle, then refresh happens, circle activation
        //        is revoked)         
     */
    onChangeHandler() {
        this.log("onChangeHandler() =================", new Date(), this.isNewSceneVersion());        
        const appState = this.excalidrawRef.current.getAppState() || {};

        // if cursor is down, rectangle is not yet part of elements. updating and refreshing breaks stuff
        const isCursorUp = appState.cursorButton === "up";
        // changeHandler is called upon any tiny change in excalidraw. button clicked, hover, etc.
        // make sure only when a new element is added, we actually save something.
        const isNewSceneVersion = this.isNewSceneVersion();
        // FIXME: however, we might want to make an exception, if viewport changed, since viewport
        //        is desired to save? (add)

        const shouldSave = isCursorUp && isNewSceneVersion;

        if (shouldSave) {
            this.updateSceneVersion();
            this.saveData();
        } else {
            // do nothing
        }
    }

    ExcalidrawReactApp() {
        var self = this;

        const React = window.React;
        const Excalidraw = window.Excalidraw;

        const excalidrawRef = React.useRef(null);
        this.excalidrawRef = excalidrawRef;
        const excalidrawWrapperRef = React.useRef(null);
        const [dimensions, setDimensions] = React.useState({
            width: undefined,
            height: undefined
        });
        self.setDimensions = setDimensions;

        const [viewModeEnabled, setViewModeEnabled] = React.useState(false);
        const [zenModeEnabled, setZenModeEnabled] = React.useState(false);
        const [gridModeEnabled, setGridModeEnabled] = React.useState(false);
        
        React.useEffect(() => {
            const dimensions = {
                width: excalidrawWrapperRef.current.getBoundingClientRect().width,
                height: excalidrawWrapperRef.current.getBoundingClientRect().height
            };
            this.log('effect, setdimensions', dimensions);
            setDimensions(dimensions);

            const onResize = () => {
                const dimensions = {
                    width: excalidrawWrapperRef.current.getBoundingClientRect().width,
                    height: excalidrawWrapperRef.current.getBoundingClientRect().height
                };
                this.log('onResize, setdimensions', dimensions);
                setDimensions(dimensions);
            };
            
            window.addEventListener("resize", onResize);
            
            return () => window.removeEventListener("resize", onResize);
        }, [excalidrawWrapperRef]);

        return React.createElement(
            React.Fragment,
            null,
            React.createElement(
                "div",
                {
                    className: "excalidraw-wrapper",
                    ref: excalidrawWrapperRef
                },
                React.createElement(Excalidraw.default, {
                    ref: excalidrawRef,
                    width: dimensions.width,
                    height: dimensions.height,
                    // initialData: InitialData,
                    onPaste: (data, event) => {
                        this.log("tom", data, event);
                    },
                    // onChange: (elements, state) => {
                    //     this.log("onChange Elements :", elements, "State : ", state)
                    //     debounce(() => {
                    //         this.log('called onChange via throttle');
                    //         self.saveData();
                    //     }, 400);
                    // },
                    onChange: debounce(self.onChangeHandler, self.debounceTimeOnchangeHandler),
                    // onPointerUpdate: (payload) => console.log(payload),
                    onCollabButtonClick: () => {
                        window.alert("You clicked on collab button")
                    },
                    viewModeEnabled: viewModeEnabled,
                    zenModeEnabled: zenModeEnabled,
                    gridModeEnabled: gridModeEnabled,
                    isCollaborating: false,
                    detectScroll: false,
                    handleKeyboardGlobally: false,
                    autoFocus: true,
                })
            )
        );
    }    

    /**
     * needed to ensure, that multipleOnChangeHandler calls do not trigger a safe.
     * we compare the scene version as suggested in:
     * https://github.com/excalidraw/excalidraw/issues/3014#issuecomment-778115329
     * 
     * info: sceneVersions are not incrementing. it seems to be a pseudo-random number
     */
     isNewSceneVersion() {
        const sceneVersion = this.getSceneVersion();
        this.log("isNewSceneVersion()", this.currentSceneVersion, sceneVersion);
        if (
            this.currentSceneVersion === -1     // initial scene version update
            || this.currentSceneVersion !== sceneVersion
            ) {
            return true;
        } else {
            return false;
        }
    }

    getSceneVersion() {
        const elements = this.excalidrawRef.current.getSceneElements();
        const sceneVersion = window.Excalidraw.getSceneVersion(elements);
        return sceneVersion;
    }

    updateSceneVersion() {
        this.currentSceneVersion = this.getSceneVersion();
    }
}

