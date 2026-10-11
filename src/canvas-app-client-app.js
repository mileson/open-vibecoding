/*
 * Core purpose
 * React CanvasApp component and boot logic for the `open-vibecoding canvas` app.
 *
 * Positioning
 * Raw inline <script type="module"> payload (part 2 of 2), extracted from
 * canvas-app.html.js. Concatenated after canvas-app-client-helpers.js inside
 * the same module script; the two parts share one lexical scope.
 */
export const CANVAS_APP_CLIENT_APP = `
    function CanvasApp() {
      const [initialData, setInitialData] = React.useState(null);
      const [loadError, setLoadError] = React.useState(null);
      const [locale, setLocale] = React.useState(initialLocale);
      const [selectedCount, setSelectedCount] = React.useState(0);
      const [selectedImageCount, setSelectedImageCount] = React.useState(0);
      const [isSending, setIsSending] = React.useState(false);
      const [isExporting, setIsExporting] = React.useState(false);
      const [isDownloadingSelection, setIsDownloadingSelection] = React.useState(false);
      const [isOpeningFolder, setIsOpeningFolder] = React.useState(false);
      const [actionStatus, setActionStatus] = React.useState(null);
      const [composer, setComposer] = React.useState(null);
      const [imageComposer, setImageComposer] = React.useState(null);
      const [isRequestingImage, setIsRequestingImage] = React.useState(false);
      const [libraryItems, setLibraryItems] = React.useState([]);
      const [libraryPreviews, setLibraryPreviews] = React.useState({});
      const [guide, setGuide] = React.useState(null);
      const [isImportingDirections, setIsImportingDirections] = React.useState(false);
      const latestHandoffSignalSeqRef = React.useRef(0);
      const t = messagesFor(locale);
      const aiTemplates = React.useMemo(() => imageTemplateOptions(t), [locale]);

      React.useEffect(() => {
        syncSelectionState = (appState, elements) => {
          setSelectedCount(selectedCountFromAppState(appState));
          setSelectedImageCount(selectedImageCountFromAppState(appState, elements));
        };
        return () => {
          syncSelectionState = () => {};
        };
      }, []);

      React.useEffect(() => {
        const shouldApplyHandoffSignal = (op) => {
          const seq = Number(op.seq || 0);
          if (seq > 0 && seq < latestHandoffSignalSeqRef.current) {
            return false;
          }
          if (seq > 0) {
            latestHandoffSignalSeqRef.current = seq;
          }
          return true;
        };
        syncCodexRelayStatus = (op) => {
          if (!shouldApplyHandoffSignal(op)) {
            return;
          }
          if (op.dryRun) {
            setActionStatus(null);
            return;
          }
          if (op.status === "completed" || op.status === "started") {
            setActionStatus({ type: "success", message: t.sentBodyWithRelay });
          } else if (["queued", "starting", "resuming", "connecting"].includes(op.status)) {
            setActionStatus({ type: "busy", message: t.sentBodyPending });
          } else if (op.status === "failed" || op.status === "timeout" || op.status === "closed") {
            setActionStatus({ type: "error", message: op.error || t.agentBridgeFailed });
          }
        };
        syncAgentBridgeStatus = (op) => {
          if (!shouldApplyHandoffSignal(op)) {
            return;
          }
          if (op.status === "sent") {
            setActionStatus({ type: "success", message: t.agentBridgeSent });
          } else if (op.status === "failed") {
            setActionStatus({ type: "error", message: op.reason || t.agentBridgeFailed });
          } else if (op.status === "pending" || op.status === "claimed") {
            setActionStatus({ type: "busy", message: agentBridgePendingMessage(t, op.status) });
          }
        };
        return () => {
          syncCodexRelayStatus = () => {};
          syncAgentBridgeStatus = () => {};
        };
      }, [t]);

      React.useEffect(() => {
        document.documentElement.lang = locale;
        try {
          window.localStorage.setItem(localeConfig.storageKey, locale);
        } catch {}
      }, [locale]);

      React.useEffect(() => {
        let mounted = true;
        Promise.all([
          fetchJson("/api/scene"),
          fetchJson("/api/library").catch(() => ({ libraryItems: [] })),
        ])
          .then(([scene, library]) => {
            if (mounted) {
              const libraryItems = libraryItemsFromPayload(library);
              const normalizedScene = normalizeInitialScene(scene);
              setInitialData({
                ...normalizedScene,
                libraryItems,
              });
              setLibraryItems(libraryItems);
              latestElements = normalizedScene.elements;
              latestAppState = normalizedScene.appState;
              latestFiles = normalizedScene.files;
              setSelectedCount(selectedCountFromAppState(normalizedScene.appState));
              setSelectedImageCount(selectedImageCountFromAppState(normalizedScene.appState, normalizedScene.elements));
              if (scene?.appState?.viewBackgroundColor !== normalizedScene.appState.viewBackgroundColor) {
                fetchJson("/api/scene", {
                  method: "POST",
                  body: JSON.stringify({
                    type: "openprd.canvas.scene.v1",
                    elements: normalizedScene.elements,
                    appState: stripAppState(normalizedScene.appState),
                    files: normalizedScene.files,
                    savedAt: new Date().toISOString(),
                  }),
                }).catch((error) => {
                  console.warn("Open VibeCoding canvas background migration failed", error);
                });
              }
            }
          })
          .catch((error) => {
            if (mounted) {
              setLoadError(error);
            }
          });
        return () => {
          mounted = false;
          window.clearInterval(pollTimer);
        };
      }, []);

      React.useEffect(() => {
        pollTimer = window.setInterval(pollOperations, 1400);
        pollOperations();
        return () => window.clearInterval(pollTimer);
      }, []);

      React.useEffect(() => {
        let mounted = true;
        const loadGuide = () => {
          fetchJson("/api/guide")
            .then((result) => {
              if (mounted && result && result.ok && result.currentStage) {
                setGuide(result);
              }
            })
            .catch(() => {});
        };
        loadGuide();
        const timer = window.setInterval(loadGuide, 30000);
        return () => {
          mounted = false;
          window.clearInterval(timer);
        };
      }, []);

      async function handleImportReviewDirections() {
        if (isImportingDirections) {
          return;
        }
        setIsImportingDirections(true);
        try {
          const result = await importReviewDirectionsToCanvas(t);
          setActionStatus({ type: "success", message: formatMessage(t.reviewDirectionsImported, { count: result.count }) });
        } catch (error) {
          setActionStatus({
            type: "error",
            message: error?.code === "empty" ? t.reviewDirectionsEmpty : t.reviewDirectionsFailed,
          });
        } finally {
          setIsImportingDirections(false);
        }
      }

      React.useEffect(() => {
        hideNativeExcalidrawChrome();
        const observer = new MutationObserver(hideNativeExcalidrawChrome);
        const root = document.querySelector(".canvas-wrap");
        if (root) {
          observer.observe(root, { childList: true, subtree: true });
        }
        return () => observer.disconnect();
      }, [initialData, locale]);

      React.useEffect(() => {
        let cancelled = false;
        async function buildPreviews() {
          if (!initialData || !exportToCanvas || libraryItems.length === 0) {
            setLibraryPreviews({});
            return;
          }
          const previews = {};
          for (const item of libraryItems.slice(0, 40)) {
            if (cancelled || !Array.isArray(item.elements) || item.elements.length === 0) {
              continue;
            }
            try {
              const canvas = await exportToCanvas({
                elements: item.elements,
                appState: {
                  exportBackground: true,
                  viewBackgroundColor: "#ffffff",
                },
                files: currentFilesForFile(),
                exportPadding: 12,
                maxWidthOrHeight: 320,
              });
              previews[item.id] = canvas.toDataURL("image/png");
            } catch (error) {
              console.warn("Open VibeCoding canvas library preview failed", error);
            }
          }
          if (!cancelled) {
            setLibraryPreviews(previews);
          }
        }
        buildPreviews();
        return () => {
          cancelled = true;
        };
      }, [initialData, libraryItems]);

      function changeLocale(event) {
        setLocale(normalizeLocale(event.target.value));
      }

      async function copyThreadPrompt() {
        const copied = await copyTextToClipboard(buildThreadPrompt(t));
        setActionStatus({
          type: copied ? "success" : "error",
          message: copied ? t.threadPromptCopied : t.threadPromptCopyFailed,
        });
      }

      function resetCanvas() {
        if (!window.confirm(t.resetConfirm)) {
          return;
        }
        latestElements = [];
        latestFiles = {};
        latestAppState = normalizeCanvasAppState({
          ...latestAppState,
          selectedElementIds: {},
        });
        excalidrawAPI?.updateScene?.({ elements: [], appState: latestAppState });
        setSelectedCount(0);
        setSelectedImageCount(0);
        setActionStatus({ type: "success", message: t.resetCanvas });
        queueSave();
      }

      async function persistLibraryItems(items, intent = "sync-excalidraw-library") {
        return fetchJson("/api/library", {
          method: "POST",
          body: JSON.stringify({
            type: "excalidrawlib",
            version: 2,
            source: "https://openprd.local/canvas",
            libraryItems: items,
            intent,
            locale,
          }),
        });
      }

      function handleLibraryChange(items) {
        const nextItems = Array.isArray(items) ? items : [];
        setLibraryItems(nextItems);
        persistLibraryItems(nextItems).catch((error) => {
          console.warn("Open VibeCoding canvas library save failed", error);
        });
      }

      async function openContainingFolder(target) {
        const downloadFileName = target?.downloadFileName || "";
        const targetPath = target?.openPath || "";
        if ((!downloadFileName && !targetPath) || isOpeningFolder) {
          return;
        }
        setIsOpeningFolder(true);
        try {
          await fetchJson(downloadFileName ? "/api/open-download" : "/api/open-folder", {
            method: "POST",
            body: JSON.stringify(downloadFileName ? { filename: downloadFileName } : { path: targetPath }),
          });
        } catch (error) {
          console.warn("Open VibeCoding canvas open folder failed", error);
          setActionStatus((current) => ({
            type: "error",
            message: t.openFolderFailed,
            openPath: current?.openPath || targetPath,
            downloadFileName: current?.downloadFileName || downloadFileName,
          }));
        } finally {
          setIsOpeningFolder(false);
        }
      }

      async function handleSaveCanvas() {
        setActionStatus({ type: "busy", message: t.savingCanvas });
        try {
          const result = await saveCanvasToDisk();
          setActionStatus({
            type: "success",
            message: formatMessage(t.savedCanvas, { filename: result.filename }),
            downloadFileName: result.filename,
          });
        } catch (error) {
          console.warn("Open VibeCoding canvas save-as failed", error);
          setActionStatus({ type: "error", message: t.saveFailed });
        }
      }

      async function handleExportImage() {
        if (isExporting) {
          return;
        }
        setIsExporting(true);
        setActionStatus({ type: "busy", message: t.exportingImage });
        try {
          const exportData = await exportCanvasImage(locale);
          const path = exportData.exportPath || exportData.fileName || exportData.exportUrl || "";
          setActionStatus({
            type: "success",
            message: formatMessage(t.exportedImage, { path }),
            openPath: exportData.exportPath || "",
          });
        } catch (error) {
          console.warn("Open VibeCoding canvas image export failed", error);
          setActionStatus({ type: "error", message: error?.code === "empty-scene" ? t.emptySceneExportBody : t.exportFailed });
        } finally {
          setIsExporting(false);
        }
      }

      async function downloadSelectedImage() {
        if (isDownloadingSelection || selectedImageCount <= 0) {
          return;
        }
        setIsDownloadingSelection(true);
        setActionStatus({ type: "busy", message: t.downloadingSelectedImage });
        try {
          const filename = createExportFilename("open-vibecoding-selected-image");
          const exported = await exportCanvasElements({
            requireSelection: true,
            intent: "download-selected-image",
            locale,
            filename,
          });
          const exportData = exported.result.export || {};
          const result = await fetchJson("/api/download-image", {
            method: "POST",
            body: JSON.stringify({
              path: exportData.exportPath,
              filename: exportData.fileName || filename,
            }),
          });
          const fileName = result.file?.fileName || exportData.fileName || filename;
          setActionStatus({
            type: "success",
            message: formatMessage(t.downloadedSelectedImage, { filename: fileName }),
            downloadFileName: fileName,
          });
        } catch (error) {
          console.warn("Open VibeCoding canvas selected image download failed", error);
          setActionStatus({ type: "error", message: t.downloadSelectedImageFailed });
        } finally {
          setIsDownloadingSelection(false);
        }
      }

      function libraryItemName(item, index) {
        return item?.name || formatMessage(t.libraryItemName, {
          index: index + 1,
          count: Array.isArray(item?.elements) ? item.elements.length : 0,
        });
      }

      function insertLibraryItem(item) {
        if (!item || !Array.isArray(item.elements) || item.elements.length === 0) {
          return;
        }
        const bounds = boundsForElements(item.elements);
        const point = getViewportDropPoint(bounds.width, bounds.height);
        const offsetX = point.x - bounds.x;
        const offsetY = point.y - bounds.y;
        const cloned = item.elements.map((element) => cloneLibraryElement(element, offsetX, offsetY));
        updateScene([...latestElements, ...cloned]);
        setActionStatus({ type: "success", message: t.insertedLibraryItem });
      }

      function updateComposerInstruction(event) {
        const value = event.target.value;
        setComposer((current) => current ? { ...current, instruction: value, status: current.status === "sent" ? "ready" : current.status, promptText: "" } : current);
      }

      async function prepareSelectionForCodex() {
        if (isSending) {
          return;
        }
        setIsSending(true);
        setComposer(null);
        try {
          const selected = currentSelectedElements();
          if (selected.length === 0) {
            setComposer({
              status: "error",
              title: t.emptySelectionTitle,
              body: t.emptySelectionBody,
            });
            return;
          }
          const filename = createExportFilename("codex-selection");
          const exported = await exportCanvasElements({
            requireSelection: true,
            intent: "codex-handoff",
            locale,
            filename,
          });
          const exportPath = exported.result.export.exportPath;
          setComposer({
            status: "ready",
            title: t.composerTitle,
            body: "",
            exported,
            exportPath,
            exportUrl: exported.result.export.exportUrl,
            elementCount: exported.elements.length,
            instruction: "",
            promptText: "",
          });
        } catch (error) {
          setComposer({
            status: "error",
            title: t.sendErrorTitle,
            body: error.message || String(error),
          });
        } finally {
          setIsSending(false);
        }
      }

      async function sendComposerToCodex() {
        if (!composer?.exported || isSending) {
          return;
        }
        setIsSending(true);
        setComposer((current) => current ? { ...current, status: "sending", error: "" } : current);
        try {
          const instruction = String(composer.instruction || "").trim();
          const annotationContext = annotationEditContextFor(composer.exported.selected);
          const promptText = buildCodexPrompt(t, composer.exportPath, composer.elementCount, instruction, annotationContext);
          let relayTimedOut = false;
          const relay = await withTimeout(recordCodexHandoff(composer.exported, promptText, locale, instruction, annotationContext), codexRelayUiTimeoutMs).catch((error) => {
            relayTimedOut = error?.message === "timeout";
            console.warn("Open VibeCoding canvas handoff record failed", error);
            return null;
          });
          const copied = await withTimeout(copyTextToClipboard(promptText), 1800).catch(() => false);
          const relayed = relayWasAccepted(relay);
          const agentBridgePending = agentBridgeIsPending(relay);
          const relayPending = relayIsPending(relay, relayTimedOut);
          setComposer((current) => current ? {
            ...current,
            status: "sent",
            copied,
            body: agentBridgePending ? t.sentBodyAgentBridge : (relayed ? t.sentBodyWithRelay : (relayPending ? t.sentBodyPending : (copied ? t.sentBody : t.sendManualCopyBody))),
            promptText,
          } : current);
        } catch (error) {
          setComposer((current) => current ? {
            ...current,
            status: "ready",
            error: error.message || String(error),
          } : current);
        } finally {
          setIsSending(false);
        }
      }

      async function copyCurrentPrompt() {
        if (composer?.promptText) {
          await copyTextToClipboard(composer.promptText);
        }
      }

      function openImageTemplate(template) {
        setImageComposer({
          status: "ready",
          template,
          instruction: "",
          promptText: "",
          error: "",
        });
      }

      function updateImageComposerInstruction(event) {
        const value = event.target.value;
        setImageComposer((current) => current ? {
          ...current,
          instruction: value,
          status: current.status === "sent" ? "ready" : current.status,
          error: "",
        } : current);
      }

      async function submitImageTemplateRequest() {
        if (!imageComposer?.template || isRequestingImage) {
          return;
        }
        const instruction = String(imageComposer.instruction || "").trim();
        if (!instruction) {
          setImageComposer((current) => current ? { ...current, error: t.imagePromptRequired } : current);
          return;
        }
        setIsRequestingImage(true);
        setImageComposer((current) => current ? { ...current, status: "sending", error: "" } : current);
        try {
          const created = createAiImageCard(imageComposer.template, instruction, t);
          const promptText = buildImageRequestPrompt(t, imageComposer.template, instruction, created.placeholderId);
          attachAiImagePrompt(created.placeholderId, promptText);
          let relayTimedOut = false;
          const relay = await withTimeout(recordCodexImageRequestHandoff(promptText, locale, instruction, imageComposer.template, created), codexRelayUiTimeoutMs).catch((error) => {
            relayTimedOut = error?.message === "timeout";
            console.warn("Open VibeCoding canvas image handoff record failed", error);
            return null;
          });
          const copied = await withTimeout(copyTextToClipboard(promptText), 1800).catch(() => false);
          const relayed = relayWasAccepted(relay);
          const agentBridgePending = agentBridgeIsPending(relay);
          const relayPending = relayIsPending(relay, relayTimedOut);
          setActionStatus({
            type: relayed ? "success" : (agentBridgePending || relayPending ? "busy" : "success"),
            message: agentBridgePending ? t.imageRequestAgentBridge : (relayed ? t.imageRequestSent : (relayPending ? t.imageRequestPending : (copied ? t.imageRequestPrepared : t.imageRequestManualCopy))),
          });
          setImageComposer(null);
        } catch (error) {
          console.warn("Open VibeCoding canvas image request failed", error);
          setImageComposer((current) => current ? {
            ...current,
            status: "ready",
            error: error.message || String(error),
          } : current);
        } finally {
          setIsRequestingImage(false);
        }
      }

      if (loadError) {
        return h("div", { className: "fallback" },
          h("div", null,
            h("strong", null, t.loadErrorTitle),
            h("span", null, loadError.message || String(loadError)),
          ),
        );
      }

      if (!initialData) {
        return h("div", { className: "fallback" },
          h("div", null,
            h("strong", null, t.loadingTitle),
            h("span", null, t.loadingBody),
          ),
        );
      }

      return h("div", { className: "shell" },
        h("header", { className: "topbar" },
          h("div", { className: "brand" },
            h("strong", null, "Open VibeCoding Canvas"),
            h("span", null, t.appSubtitle),
          ),
          h("div", { className: "actions" },
            h("select", {
              className: "language-select",
              "aria-label": t.languageLabel,
              "data-testid": "open-vibecoding-canvas-locale",
              value: locale,
              onChange: changeLocale,
            },
              h("option", { value: "zh-CN" }, "中文"),
              h("option", { value: "en" }, "English"),
            ),
          ),
        ),
        h("main", { className: "layout" },
          h("section", { className: "canvas-wrap" },
            h(Excalidraw, {
              excalidrawAPI: (api) => {
                excalidrawAPI = api;
                window.__openprdExcalidrawAPI = api;
              },
              initialData,
              name: "Open VibeCoding Canvas",
              langCode: locale,
              UIOptions: {
                canvasActions: {
                  loadScene: false,
                  saveToActiveFile: false,
                  export: {
                    saveFileToDisk: true,
                  },
                },
              },
              onChange: (elements, appState, files) => {
                latestElements = elements || [];
                latestAppState = normalizeCanvasAppState(appState || {});
                latestFiles = files || {};
                setSelectedCount(selectedCountFromAppState(latestAppState));
                setSelectedImageCount(selectedImageCountFromAppState(latestAppState, latestElements));
                queueSave();
              },
              onLibraryChange: handleLibraryChange,
            }),
            selectedCount > 0 && h("div", { className: "selection-sendbar", "data-testid": "open-vibecoding-canvas-selection-sendbar" },
              h("strong", null, formatMessage(t.selectedCount, { count: selectedCount })),
              selectedImageCount > 0 && h("button", {
                className: "text-button subtle-button",
                disabled: isDownloadingSelection || isSending,
                onClick: downloadSelectedImage,
                "data-testid": "open-vibecoding-canvas-download-image",
              }, toolIcon("export"), h("span", null, isDownloadingSelection ? t.downloadingSelectedImage : t.downloadSelectedImage)),
              h("button", {
                className: "text-button primary-button",
                disabled: isSending,
                onClick: prepareSelectionForCodex,
                "data-testid": "open-vibecoding-canvas-send-codex",
              }, toolIcon("send"), h("span", null, isSending ? t.sendingToCodex : t.sendToCodex)),
            ),
            composer && h("div", { className: "composer-backdrop", "data-testid": "open-vibecoding-canvas-composer" },
              h("section", { className: "composer-modal", role: "dialog", "aria-modal": "true", "aria-labelledby": "open-vibecoding-canvas-composer-title" },
                h("div", { className: "composer-header" },
                  h("h2", { id: "open-vibecoding-canvas-composer-title" }, composer.title || t.composerTitle),
                  h("button", { className: "text-button", onClick: () => setComposer(null) }, h("span", null, t.dismiss)),
                ),
                h("div", { className: "composer-body" },
                  composer.exportUrl && h(React.Fragment, null,
                    h("p", { className: "composer-label" }, t.previewLabel),
                    h("img", { className: "composer-preview", src: composer.exportUrl, alt: t.composerPreviewAlt }),
                  ),
                  composer.exported && h(React.Fragment, null,
                    h("p", { className: "composer-label" }, t.instructionLabel),
                    h("textarea", {
                      className: "composer-input",
                      value: composer.instruction || "",
                      placeholder: t.instructionPlaceholder,
                      disabled: isSending || composer.status === "sent",
                      onChange: updateComposerInstruction,
                      "data-testid": "open-vibecoding-canvas-composer-prompt",
                    }),
                  ),
                  composer.body && h("p", { className: "composer-status" }, composer.body),
                  composer.error && h("p", { className: "composer-error" }, composer.error),
                ),
                h("div", { className: "composer-actions" },
                  composer.promptText && h("button", { className: "text-button", onClick: copyCurrentPrompt }, toolIcon("copy"), h("span", null, t.copyPrompt)),
                  composer.exported && h("button", {
                    className: "text-button primary-button",
                    disabled: isSending || composer.status === "sent",
                    onClick: sendComposerToCodex,
                    "data-testid": "open-vibecoding-canvas-composer-submit",
                  }, toolIcon("send"), h("span", null, isSending || composer.status === "sending" ? t.sendingToCodex : t.sendToCodex)),
                ),
              ),
            ),
            imageComposer && h("div", { className: "composer-backdrop", "data-testid": "open-vibecoding-canvas-image-composer" },
              h("section", { className: "composer-modal", role: "dialog", "aria-modal": "true", "aria-labelledby": "open-vibecoding-canvas-image-composer-title" },
                h("div", { className: "composer-header" },
                  h("h2", { id: "open-vibecoding-canvas-image-composer-title" }, t.aiImageComposerTitle),
                  h("button", { className: "text-button", onClick: () => setImageComposer(null), disabled: isRequestingImage }, h("span", null, t.dismiss)),
                ),
                h("div", { className: "composer-body" },
                  h("p", { className: "composer-label" }, t.aiImageTemplateLabel),
                  h("div", { className: "template-compose-preview" },
                    h("div", {
                      className: "template-compose-frame",
                      style: { aspectRatio: imageComposer.template.width + " / " + imageComposer.template.height },
                    }, h("span", null, imageComposer.template.label)),
                  ),
                  h("p", { className: "composer-label" }, t.aiImageInstructionLabel),
                  h("textarea", {
                    className: "composer-input",
                    value: imageComposer.instruction || "",
                    placeholder: t.aiImageInstructionPlaceholder,
                    disabled: isRequestingImage,
                    onChange: updateImageComposerInstruction,
                    "data-testid": "open-vibecoding-canvas-image-prompt",
                  }),
                  imageComposer.error && h("p", { className: "composer-error" }, imageComposer.error),
                ),
                h("div", { className: "composer-actions" },
                  h("button", { className: "text-button", onClick: () => setImageComposer(null), disabled: isRequestingImage }, h("span", null, t.dismiss)),
                  h("button", {
                    className: "text-button primary-button",
                    disabled: isRequestingImage,
                    onClick: submitImageTemplateRequest,
                    "data-testid": "open-vibecoding-canvas-create-ai-image",
                  }, toolIcon("send"), h("span", null, isRequestingImage ? t.sendingToCodex : t.createAiImageCard)),
                ),
              ),
            ),
          ),
          h("aside", { className: "rail" },
            h("section", { className: "thread-summary", "data-testid": "open-vibecoding-canvas-thread-summary" },
              h("p", { className: "thread-title" }, conversationTitle(t)),
              h("div", { className: "thread-id-row" },
                h("p", { className: "thread-id" }, conversationId()),
                h("button", {
                  className: "thread-copy-button",
                  type: "button",
                  title: t.copyThreadPrompt,
                  "aria-label": t.copyThreadPrompt,
                  onClick: copyThreadPrompt,
                  "data-testid": "open-vibecoding-canvas-copy-thread",
                }, toolIcon("copy")),
              ),
            ),
            h("section", { className: "rail-actions", "data-testid": "open-vibecoding-canvas-rail-actions" },
              h("div", { className: "rail-action-group", "data-testid": "open-vibecoding-canvas-review-board" },
                h("p", { className: "rail-heading" }, t.reviewBoardTitle),
                guide && h("div", { className: "guide-strip", "data-testid": "open-vibecoding-canvas-guide" },
                  h("strong", null, guide.mode === "contextual"
                    ? t.reviewGuideContextual
                    : formatMessage(t.reviewGuideStage, {
                      index: guide.currentStage.index,
                      total: guide.totalStages,
                      title: guide.currentStage.title,
                    })),
                  guide.mode === "contextual"
                    ? h("span", null, t.reviewGuideContextualHint)
                    : guide.nextAction && h("span", null, formatMessage(t.reviewGuideNext, { action: guide.nextAction })),
                ),
                h("button", {
                  className: "rail-action-button",
                  title: t.importReviewDirections,
                  disabled: isImportingDirections,
                  onClick: handleImportReviewDirections,
                  "data-testid": "open-vibecoding-canvas-import-directions",
                }, toolIcon("export"), h("span", null, isImportingDirections ? t.importingReviewDirections : t.importReviewDirections)),
              ),
              h("div", { className: "rail-action-group" },
                h("p", { className: "rail-heading" }, t.canvasActionsTitle),
                h("div", { className: "rail-action-grid" },
                  h("button", {
                    className: "rail-action-button",
                    title: t.saveCanvas,
                    onClick: handleSaveCanvas,
                    "data-testid": "open-vibecoding-canvas-save",
                  }, toolIcon("save"), h("span", null, t.saveCanvas)),
                  h("button", {
                    className: "rail-action-button",
                    title: t.exportImage,
                    disabled: isExporting,
                    onClick: handleExportImage,
                    "data-testid": "open-vibecoding-canvas-export-image",
                  }, toolIcon("export"), h("span", null, isExporting ? t.exportingImage : t.exportImage)),
                  h("button", {
                    className: "rail-action-button danger",
                    title: t.resetCanvas,
                    onClick: resetCanvas,
                    "data-testid": "open-vibecoding-canvas-reset",
                  }, toolIcon("reset"), h("span", null, t.resetCanvas)),
                ),
                actionStatus && h("div", {
                  className: "action-status" + (actionStatus.type === "error" ? " error" : "") + (actionStatus.type === "busy" ? " busy" : ""),
                  "data-testid": "open-vibecoding-canvas-action-status",
                },
                  h("span", null, actionStatus.message),
                  (actionStatus.openPath || actionStatus.downloadFileName) && h("button", {
                    className: "status-folder-button",
                    disabled: isOpeningFolder,
                    onClick: () => openContainingFolder(actionStatus),
                    "data-testid": "open-vibecoding-canvas-open-folder",
                  }, isOpeningFolder ? t.openingFolder : t.openContainingFolder),
                ),
              ),
              h("div", { className: "rail-action-group" },
                h("p", { className: "rail-heading" }, t.aiImageTemplatesTitle),
                h("div", { className: "template-grid", "data-testid": "open-vibecoding-canvas-ai-templates" },
                  aiTemplates.map((template) => h("button", {
                    key: template.id,
                    className: "template-tile",
                    title: template.title + " " + template.label,
                    onClick: () => openImageTemplate(template),
                    "data-testid": "open-vibecoding-canvas-ai-template-" + template.id,
                  },
                    h("span", {
                      className: "template-preview",
                      style: { aspectRatio: template.width + " / " + template.height },
                      "aria-hidden": "true",
                    }),
                    h("strong", null, template.label),
                    h("span", null, template.title),
                  )),
                ),
              ),
              h("div", { className: "rail-action-group" },
                h("p", { className: "rail-heading" }, t.personalLibraryTitle),
                h("div", { className: "library-grid", "data-testid": "open-vibecoding-canvas-personal-library" },
                  libraryItems.map((item, index) => h("button", {
                    key: item.id || index,
                    className: "library-tile",
                    title: libraryItemName(item, index),
                    onClick: () => insertLibraryItem(item),
                    "data-testid": "open-vibecoding-canvas-library-item",
                  },
                    h("span", { className: "library-item-preview", "aria-hidden": "true" },
                      libraryPreviews[item.id]
                        ? h("img", { src: libraryPreviews[item.id], alt: "" })
                        : h("span", null, formatMessage(t.libraryItemCount, { count: Array.isArray(item.elements) ? item.elements.length : 0 })),
                    ),
                    h("span", null, libraryItemName(item, index)),
                  )),
                  h("button", {
                    className: "library-tile",
                    title: t.blankCard,
                    onClick: () => addBlankCard(t.placeholderText),
                    "data-testid": "open-vibecoding-canvas-blank-card",
                  },
                    h("span", { className: "library-card-preview", "aria-hidden": "true" }),
                    h("span", null, t.blankCard),
                  ),
                ),
              ),
            ),
          ),
        ),
      );
    }

    createRoot(document.getElementById("root")).render(h(CanvasApp));
`;
