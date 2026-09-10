const {
  aiImagesRequested,
  mediaProviderIssue,
} = require('../utils/providerCapabilities.cjs');
const { jsPDF } = require('jspdf');
const axios = require('axios');
const {
  buildDataUrl,
  parseDataUrl,
  now,
  elapsedMs,
  createERC,
  isValidUrl,
} = require('../utils/misc.cjs');
const { ERC_PREFIX } = require('../utils/constants.cjs');
const { SELECTION_KEYS, selectShare } = require('../utils/shareSelection.cjs');

class MediaGenerator {
  constructor(ctx) {
    this.ctx = ctx;
    this.mockImage = null;
    this.mockPdf = null;
  }

  getMockBase64Image = () => {
    if (!this.mockImage) {
      this.mockImage = require('../data/mock-image.json');
    }
    return this.mockImage;
  };

  getMockBase64Pdf = () => {
    if (!this.mockPdf) {
      this.mockPdf = require('../data/mock-pdf.json');
    }
    return this.mockPdf;
  };

  resolveOperation(config, explicit) {
    return explicit || config?.operation || this.ctx?.operation || 'generate';
  }

  async getDefaultBase64ImageDataUrl(config) {
    const image = await this.getDefaultBase64Image(config);
    return buildDataUrl(image);
  }

  async getDefaultBase64Image(config) {
    const { config: configService, logger } = this.ctx;
    try {
      const dataUrl = await configService.getDefaultImage(config);
      if (typeof dataUrl !== 'string') {
        throw new Error('Default image configuration is missing or invalid');
      }
      return parseDataUrl(dataUrl);
    } catch (err) {
      logger.error('Failed to retrieve default image; using fallback', {
        operation: this.resolveOperation(config),
        correlationId: config?.correlationId || '∅',
        error: err.message,
      });
      return this.getMockBase64Image();
    }
  }

  async getDefaultBase64PdfDataUrl(config) {
    const pdf = await this.getDefaultBase64Pdf(config);
    return buildDataUrl(pdf);
  }

  async getDefaultBase64Pdf(config) {
    const { config: configService, logger } = this.ctx;
    try {
      const dataUrl = await configService.getDefaultPdf(config);
      if (typeof dataUrl !== 'string') {
        throw new Error('Default PDF configuration is missing or invalid');
      }
      return parseDataUrl(dataUrl);
    } catch (err) {
      logger.error('Failed to retrieve default PDF; using fallback', {
        operation: this.resolveOperation(config),
        correlationId: config?.correlationId || '∅',
        error: err.message,
      });
      return this.getMockBase64Pdf();
    }
  }

  async generateImageData(
    baseName,
    width,
    height = width,
    format,
    preventCache = true,
    grayscale = false,
    blur,
    seed,
    id
  ) {
    const actualWidth = Math.max(1, Math.floor(width || 1));
    const actualHeight = Math.max(1, Math.floor(height || actualWidth));
    const isSquare = actualWidth === actualHeight;
    let url = 'https://picsum.photos/';
    if (seed && !id) url += `seed/${seed}/`;
    url += isSquare ? `${actualWidth}` : `${actualWidth}/${actualHeight}`;
    if (id && !seed) url += `/${id}`;
    if (format === 'webp' || format === 'jpg') url += `.${format}`;
    const params = new URLSearchParams();
    if (preventCache && !seed && !id) params.append('random', now());
    if (grayscale) params.append('grayscale', '');
    if (blur)
      params.append(
        'blur',
        isNaN(blur) ? '' : Math.min(Math.max(parseInt(blur), 1), 10)
      );
    const query = params.toString();
    if (query) url += `?${query}`;
    return {
      title: { en_US: `${baseName} Product Image` },
      type: 'image',
      src: url,
      priority: 1,
    };
  }

  async generateProductPDF(pdfContent, productSku, config, sessionId) {
    const { logger, progress } = this.ctx;
    const correlationId = config?.correlationId || '∅';
    const operation = this.resolveOperation(config, 'process-attachments');
    const batchId = `pdf-gen-${productSku}`;

    progress.batchStarted(
      { sessionId, batchId, entityType: 'pdfs', totalItems: 1, operation },
      { correlationId }
    );
    const startedAt = now();
    try {
      const doc = new jsPDF({
        orientation: 'portrait',
        unit: 'pt',
        format: 'a4',
        hotfixes: ['px_scaling'],
      });
      const pageWidth = doc.internal.pageSize.getWidth();
      const pageHeight = doc.internal.pageSize.getHeight();
      const margin = 40;
      const maxWidth = pageWidth - margin * 2;
      let currentY = margin;
      const title =
        pdfContent?.title || `Product Documentation - ${productSku}`;
      const sections = pdfContent?.sections || [
        {
          title: 'Product Information',
          content: `Auto-generated documentation for ${productSku}.`,
        },
      ];
      doc.setFontSize(24);
      doc.setFont('helvetica', 'bold');
      const titleLines = doc.splitTextToSize(title, maxWidth);
      titleLines.forEach((line) => {
        doc.text(line, margin, currentY);
        currentY += 30;
      });
      currentY += 20;
      for (const section of sections) {
        if (currentY > pageHeight - 100) {
          doc.addPage();
          currentY = margin;
        }
        doc.setFontSize(16);
        doc.setFont('helvetica', 'bold');
        doc.text(section.title || 'Section', margin, currentY);
        currentY += 25;
        doc.setFontSize(12);
        doc.setFont('helvetica', 'normal');
        const lines = doc.splitTextToSize(
          section.content || 'Content not available.',
          maxWidth
        );
        for (const line of lines) {
          if (currentY > pageHeight - 80) {
            doc.addPage();
            currentY = margin;
          }
          doc.text(line, margin, currentY);
          currentY += 15;
        }
        currentY += 20;
      }
      const pageCount = doc.internal.getNumberOfPages();
      for (let i = 1; i <= pageCount; i++) {
        doc.setPage(i);
        doc.setFontSize(10);
        doc.setFont('helvetica', 'normal');
        doc.text(
          `Generated by AI Data Generator - Page ${i} of ${pageCount}`,
          margin,
          pageHeight - 30
        );
        doc.text(
          `Product SKU: ${productSku}`,
          pageWidth - margin - 120,
          pageHeight - 30
        );
      }
      const pdfOutput = doc.output('datauristring');
      const base64Data = pdfOutput.split(',')[1];
      const buffer = Buffer.from(base64Data, 'base64');
      const durationMs = elapsedMs(startedAt);

      progress.batchCompleted(
        {
          sessionId,
          batchId,
          entityType: 'pdfs',
          successCount: 1,
          failureCount: 0,
          operation,
          meta: { durationMs },
        },
        { correlationId }
      );
      return buffer;
    } catch (error) {
      progress.batchFailed(
        {
          sessionId,
          batchId,
          entityType: 'pdfs',
          error,
          operation,
        },
        { correlationId }
      );
      logger.error('Error generating PDF', {
        operation,
        correlationId,
        productSku,
        error: error.message,
      });
      throw error;
    }
  }

  // Both were the same function under two names, and both shuffled with
  // `sort(() => Math.random() - 0.5)` - a biased shuffle that also meant the
  // same catalogue could not be given the same media twice. A ratio above 100
  // returned nothing rather than everything. See #729.
  selectProductsForPDFs(products, ratio) {
    return selectShare(products, ratio, SELECTION_KEYS.PDFS, {
      logger: this.ctx?.logger,
    });
  }

  selectProductsForImages(products, ratio) {
    return selectShare(products, ratio, SELECTION_KEYS.IMAGES, {
      logger: this.ctx?.logger,
    });
  }

  generateProductImageSet(baseName, variants = ['main', 'thumb', 'alt']) {
    return variants.map((variant, i) => ({
      title: { en_US: `${baseName} ${variant}` },
      type: 'image',
      src: `https://picsum.photos/seed/${baseName}-${variant}/600/600.webp`,
      priority: i + 1,
    }));
  }

  /**
   * Pull the reference Liferay returns when it accepts an upload.
   *
   * The `by-base64` endpoints answer with the attachment they created - its
   * id, its own ERC and the `src` the bytes are served from. Recording those
   * is what lets a later export find the binary again: without them a run
   * knows only that it made a picture, not where the picture went, and a
   * promotion has to go looking for it product by product (#838).
   *
   * An accepted upload that answers with none of the three is not an error -
   * the media exists - but it does leave the run unable to point at it, so it
   * says so rather than recording an entry that quietly holds nothing.
   */
  _mediaReference(created, { productERC, kind, sessionId, correlationId }) {
    const { logger } = this.ctx;
    const reference = {};

    if (created?.id !== undefined && created.id !== null) {
      reference.attachmentId = created.id;
    }
    if (created?.externalReferenceCode) {
      reference.attachmentERC = created.externalReferenceCode;
    }
    if (created?.src) {
      reference.src = created.src;
    }

    if (Object.keys(reference).length === 0) {
      logger.warn(
        `Liferay accepted the ${kind} for ${productERC} but returned no id, ERC or src, so the export cannot locate it`,
        { sessionId, correlationId }
      );
    }

    return reference;
  }

  /**
   * The media a bundle carries for one product.
   *
   * The binaries live in the in-memory cache rather than in the session
   * context, because the context is JSON-serialised into `context_json` in
   * SQLite and no file content belongs in the database. The context holds the
   * key; this reads through it (#814).
   *
   * A bundle that is not there is a real fault, not an empty set: the caller
   * asked to attach media it supplied, and silently attaching nothing would
   * report a promotion as complete with no pictures on it. That happens when
   * the service restarts between the upload and the attach step, since the
   * cache does not survive it.
   */
  _bundledFor(options, productERC, kind) {
    const { cache } = this.ctx;
    const key = options?.mediaBundleKey;

    if (!key) {
      throw new Error(
        `Media mode is 'bundle' but no mediaBundleKey was supplied for ${productERC}`
      );
    }

    const bundled = cache?.get?.(key);

    if (!bundled) {
      throw new Error(
        `The media bundle ${key} is no longer held. It is kept in memory only, so a restart between upload and attach loses it; re-upload the bundle.`
      );
    }

    return (bundled || [])
      .filter((item) => item.kind === kind && item.productERC === productERC)
      .map((item) => ({
        base64: Buffer.isBuffer(item.buffer)
          ? item.buffer.toString('base64')
          : item.buffer,
        contentType: item.contentType,
        priority: item.priority ?? 1,
        title: item.title,
      }));
  }

  async createImages(config, products, options) {
    const { logger, liferay, progress, ai } = this.ctx;
    const { sessionId, correlationId: optionsCID } = options;
    const correlationId = optionsCID || config?.correlationId || '∅';

    this.validateConfig(config, options);
    await this.validateOptions(config, options);

    const imageMode = options.imageMode || 'none';
    if (imageMode === 'none') {
      logger.info('Image generation disabled (imageMode: none).', {
        sessionId,
      });
      return;
    }

    const entityType = 'images';
    const operation = 'generate';
    const batchId = `images-individual-${Date.now()}`;
    const batchERC = createERC(ERC_PREFIX.MEDIA_BATCH);

    const productsToProcess = this.selectProductsForImages(
      products,
      options.imageRatio || 0
    );

    if (productsToProcess.length === 0) {
      // Say which gate emptied the set. The mode gate above has already
      // passed, so an empty share here means the ratio - and an operator who
      // set a mode and got no images deserves to know that rather than read
      // "no products selected" and go looking at the product list (#736).
      logger.warn(
        `No products selected for image generation: imageMode is '${imageMode}' but imageRatio is ${options.imageRatio}.`,
        {
          correlationId,
          imageMode,
          imageRatio: options.imageRatio,
          productCount: products.length,
          sessionId,
        }
      );
      return;
    }

    progress.batchStarted({
      batchId,
      batchERC,
      entityType,
      totalItems: productsToProcess.length,
      operation,
      sessionId,
      correlationId,
    });

    // Layer 3 of the media-provider guard: fail before the loop rather than
    // partway through it, so no products are half-processed and the message
    // names the fix rather than surfacing a provider's internal error.
    if (aiImagesRequested(imageMode, options.demoMode)) {
      const aiConfig =
        (await this.ctx?.config?.getAIConfig?.(options.requestConfig)) || {};
      const issue = mediaProviderIssue(
        aiConfig.provider,
        aiConfig.mediaProvider
      );
      if (issue) {
        const error = new Error(`Cannot generate product images: ${issue}`);
        error.errorReference = createERC(ERC_PREFIX.ERROR);
        logger.error('Image generation blocked by provider capability', {
          correlationId,
          coreProvider: aiConfig.provider,
          mediaProvider: aiConfig.mediaProvider,
          errorReference: error.errorReference,
        });
        throw error;
      }
    }

    let completedCount = 0;
    const createdImages = [];
    for (const product of productsToProcess) {
      try {
        let imageSet = [];

        if (imageMode === 'ai' && !options.demoMode) {
          const aiResult = await ai.generateImageDataForProduct(product, {
            ...options,
            correlationId,
          });
          if (typeof aiResult === 'object' && aiResult.url) {
            imageSet = [
              {
                title: {
                  en_US: `${product.name.en_US || product.name} AI Image`,
                },
                src: aiResult.url,
                priority: 1,
              },
            ];
          } else {
            imageSet = [
              {
                title: {
                  en_US: `${product.name.en_US || product.name} AI Image`,
                },
                base64: aiResult,
                contentType: 'image/png',
                priority: 1,
              },
            ];
          }
        } else if (imageMode === 'picsum') {
          imageSet = this.generateProductImageSet(
            product.name.en_US || product.name
          );
        } else if (
          imageMode === 'placeholder' ||
          imageMode === 'default' ||
          (imageMode === 'ai' && options.demoMode)
        ) {
          const placeholder = await this.getDefaultBase64Image(config);
          imageSet = [
            {
              title: {
                en_US: `${product.name.en_US || product.name} Placeholder`,
              },
              base64: placeholder.base64,
              contentType: placeholder.contentType,
              priority: 1,
            },
          ];
        } else if (imageMode === 'bundle') {
          // The bundle already holds this product's pictures; nothing is
          // generated, and the title and priority travel with the bytes so the
          // target ends up with the same attachment, not an equivalent one.
          imageSet = this._bundledFor(
            options,
            product.externalReferenceCode,
            'image'
          ).map((entry) => ({
            base64: entry.base64,
            contentType: entry.contentType,
            priority: entry.priority,
            title: entry.title,
          }));
        } else if (imageMode === 'custom' && options.customImageFile) {
          imageSet = [
            {
              title: {
                en_US: `${product.name.en_US || product.name} Custom Image`,
              },
              base64: options.customImageFile.buffer.toString('base64'),
              contentType: options.customImageFile.mime,
              priority: 1,
            },
          ];
        }

        for (const imageData of imageSet) {
          let base64 = imageData.base64;
          let contentType = imageData.contentType;

          if (!base64 && isValidUrl(imageData.src)) {
            const response = await axios.get(imageData.src, {
              responseType: 'arraybuffer',
            });
            base64 = Buffer.from(response.data, 'binary').toString('base64');
            contentType = response.headers['content-type'] || 'image/webp';
          }

          if (!base64) continue;

          const title =
            imageData.title ||
            Object.fromEntries(
              (config.selectedLanguages || ['en-US']).map((lang) => [
                lang.replace('-', '_'),
                `${product.name.en_US || product.name} Image`,
              ])
            );

          const created = await liferay.addProductImageByBase64(
            config,
            product.externalReferenceCode,
            {
              attachment: base64,
              contentType: contentType,
              title: title,
              priority: imageData.priority || 1,
            }
          );

          createdImages.push({
            productERC: product.externalReferenceCode,
            title: title,
            contentType: contentType,
            priority: imageData.priority || 1,
            ...this._mediaReference(created, {
              productERC: product.externalReferenceCode,
              kind: 'image',
              sessionId,
              correlationId,
            }),
          });
        }
        completedCount++;
      } catch (error) {
        // The reason belongs in the message, not only in the metadata. A
        // bundle that is no longer held and a provider that refused the call
        // are the same line otherwise, and the remedies are nothing alike.
        logger.error(
          `Failed to create images for product ${product.externalReferenceCode || 'unknown'}: ${error?.message}`,
          {
            sessionId,
            correlationId,
            error: error.message,
          }
        );
      }
      progress.batchProgress({
        batchId,
        batchERC,
        entityType,
        completedCount: completedCount,
        totalItems: productsToProcess.length,
        operation,
        sessionId,
        correlationId,
      });
    }

    progress.batchCompleted({
      batchId,
      batchERC,
      entityType,
      successCount: completedCount,
      failureCount: productsToProcess.length - completedCount,
      operation,
      sessionId,
      correlationId,
    });

    return createdImages;
  }

  async createPdfs(config, products, options) {
    const { logger, liferay, progress, ai } = this.ctx;
    const { sessionId, correlationId: optionsCID } = options;
    const correlationId =
      optionsCID || config?.correlationId || this.ctx?.correlationId || '∅';

    this.validateConfig(config, options);
    await this.validateOptions(config, options);

    const pdfMode = options.pdfMode || 'none';
    if (pdfMode === 'none') {
      logger.info('PDF generation disabled (pdfMode: none).', { sessionId });
      return;
    }

    const entityType = 'pdfs';
    const operation = 'generate';
    const batchId = `pdfs-individual-${Date.now()}`;
    const batchERC = createERC(ERC_PREFIX.MEDIA_BATCH);

    const productsToProcess = this.selectProductsForPDFs(
      products,
      options.pdfRatio || 0
    );

    if (productsToProcess.length === 0) {
      logger.warn(
        `No products selected for PDF generation: pdfMode is '${pdfMode}' but pdfRatio is ${options.pdfRatio}.`,
        {
          correlationId,
          pdfMode,
          pdfRatio: options.pdfRatio,
          productCount: products.length,
          sessionId,
        }
      );
      return;
    }

    progress.batchStarted({
      batchId,
      batchERC,
      entityType,
      totalItems: productsToProcess.length,
      operation,
      sessionId,
      correlationId,
    });

    let completedCount = 0;
    const createdPdfs = [];
    for (const product of productsToProcess) {
      try {
        const sku = product.skus?.[0]?.sku || product.externalReferenceCode;

        // A generated run makes exactly one PDF per product. A bundle may
        // carry several, because it reflects whatever the source instance
        // actually held - so the attach works from a list, and every other
        // mode simply produces a list of one.
        let pdfs;

        if (pdfMode === 'bundle') {
          pdfs = this._bundledFor(
            options,
            product.externalReferenceCode,
            'pdf'
          ).map((entry) => ({
            base64: entry.base64,
            contentType: entry.contentType || 'application/pdf',
            priority: entry.priority,
            title: entry.title || { en_US: `${sku}_manual.pdf` },
          }));
        } else {
          let pdfBase64;

          if (pdfMode === 'ai' && !options.demoMode) {
            const pdfContent = await ai.generatePDFContent(
              product,
              product.categoryName || options.categories?.[0] || 'Generic',
              config,
              options.aiModel,
              options
            );

            const pdfBuffer = await this.generateProductPDF(
              pdfContent,
              sku,
              config,
              sessionId
            );
            pdfBase64 = pdfBuffer.toString('base64');
          } else if (pdfMode === 'custom' && options.customPdfFile) {
            pdfBase64 = options.customPdfFile.buffer.toString('base64');
          } else {
            // Fallback to placeholder for 'placeholder', 'default', or 'ai' in demo mode
            const mockPdf = await this.getDefaultBase64Pdf(config);
            pdfBase64 = mockPdf.base64;
          }

          pdfs = [
            {
              base64: pdfBase64,
              contentType: 'application/pdf',
              priority: 1,
              title: { en_US: `${sku}_manual.pdf` },
            },
          ];
        }

        for (const pdf of pdfs) {
          const created = await liferay.addProductDocumentAttachmentByBase64(
            config,
            product.externalReferenceCode,
            {
              attachment: pdf.base64,
              contentType: pdf.contentType,
              title: pdf.title,
              priority: pdf.priority,
            }
          );

          createdPdfs.push({
            productERC: product.externalReferenceCode,
            sku: sku,
            title: pdf.title,
            contentType: pdf.contentType,
            priority: pdf.priority,
            ...this._mediaReference(created, {
              productERC: product.externalReferenceCode,
              kind: 'PDF',
              sessionId,
              correlationId,
            }),
          });
        }

        completedCount++;
      } catch (error) {
        logger.error(
          `Failed to create PDF for product ${product.externalReferenceCode}: ${error?.message}`,
          {
            sessionId,
            correlationId,
            error: error.message,
          }
        );
      }
      progress.batchProgress({
        batchId,
        batchERC,
        entityType,
        completedCount,
        totalItems: productsToProcess.length,
        operation,
        sessionId,
        correlationId,
      });
    }

    progress.batchCompleted({
      batchId,
      batchERC,
      entityType,
      successCount: completedCount,
      failureCount: productsToProcess.length - completedCount,
      operation,
      sessionId,
      correlationId,
    });

    return createdPdfs;
  }

  validateConfig(config, options) {
    if (
      !options.demoMode &&
      options.imageMode === 'ai' &&
      (options.imageRatio ?? 0) > 0
    ) {
      if (!config.imageGenerationKey) {
        console.warn(
          'Image generation API key not configured. AI image generation may fail.'
        );
      }
    }
  }

  async validateOptions(config, options) {
    if (
      options.imageRatio &&
      (typeof options.imageRatio !== 'number' ||
        options.imageRatio < 0 ||
        options.imageRatio > 100)
    ) {
      throw new Error('imageRatio must be a number between 0 and 100');
    }
    if (
      options.pdfRatio &&
      (typeof options.pdfRatio !== 'number' ||
        options.pdfRatio < 0 ||
        options.pdfRatio > 100)
    ) {
      throw new Error('pdfRatio must be a number between 0 and 100');
    }
  }
}

module.exports = MediaGenerator;
