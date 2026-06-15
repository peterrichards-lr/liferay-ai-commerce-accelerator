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

  selectProductsForPDFs(products, ratio) {
    if (ratio <= 0 || ratio > 100) return [];
    const count = Math.ceil(products.length * (ratio / 100));
    const shuffled = [...products].sort(() => Math.random() - 0.5);
    return shuffled.slice(0, count);
  }

  selectProductsForImages(products, ratio) {
    if (ratio <= 0 || ratio > 100) return [];
    const count = Math.ceil(products.length * (ratio / 100));
    const shuffled = [...products].sort(() => Math.random() - 0.5);
    return shuffled.slice(0, count);
  }

  generateProductImageSet(baseName, variants = ['main', 'thumb', 'alt']) {
    return variants.map((variant, i) => ({
      title: { en_US: `${baseName} ${variant}` },
      type: 'image',
      src: `https://picsum.photos/seed/${baseName}-${variant}/600/600.webp`,
      priority: i + 1,
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
      logger.info('No products selected for image generation.', {
        sessionId,
        correlationId,
      });
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

          await liferay.addProductImageByBase64(
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
          });
        }
        completedCount++;
      } catch (error) {
        logger.error(
          `Failed to create images for product ${product.id || 'unknown'}`,
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
      logger.info('No products selected for PDF generation.', {
        sessionId,
        correlationId,
      });
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

        await liferay.addProductDocumentAttachmentByBase64(
          config,
          product.externalReferenceCode,
          {
            attachment: pdfBase64,
            contentType: 'application/pdf',
            title: { en_US: `${sku}_manual.pdf` },
            priority: 1,
          }
        );

        createdPdfs.push({
          productERC: product.externalReferenceCode,
          sku: sku,
          title: { en_US: `${sku}_manual.pdf` },
          contentType: 'application/pdf',
          priority: 1,
        });

        completedCount++;
      } catch (error) {
        logger.error(`Failed to create PDF for product ${product.id}`, {
          sessionId,
          correlationId,
          error: error.message,
        });
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
