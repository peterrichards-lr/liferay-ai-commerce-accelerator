const { jsPDF } = require('jspdf');
const {
  buildDataUrl,
  parseDataUrl,
  delay,
  now,
  elapsedMs,
  createERC,
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

  async generateProductPDF(pdfContent, productSku, config) {
    const { logger, ws } = this.ctx;
    const correlationId = config?.correlationId || '∅';
    const operation = this.resolveOperation(config, 'process-attachments');
    const batchId = `pdf-gen-${productSku}`;
    ws.emitBatchStarted(
      { batchId, entityType: 'media', totalItems: 1, operation },
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
      ws.emitBatchCompleted(
        {
          batchId,
          entityType: 'media',
          successCount: 1,
          failureCount: 0,
          operation,
          meta: { durationMs },
        },
        { correlationId }
      );
      return buffer;
    } catch (error) {
      ws.emitBatchCompleted(
        {
          batchId,
          entityType: 'media',
          successCount: 0,
          failureCount: 1,
          errors: [{ message: error.message }],
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

  async uploadPDFToStorage(uploadURL, pdfBuffer, filename, config) {
    const { logger } = this.ctx;
    const correlationId = config?.correlationId || '∅';
    const operation = this.resolveOperation(config, 'process-attachments');
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const response = await fetch(uploadURL, {
          method: 'PUT',
          body: pdfBuffer,
          headers: {
            'Content-Type': 'application/pdf',
            Connection: 'keep-alive',
          },
          signal: AbortSignal.timeout(60000),
        });
        if (!response.ok)
          throw new Error(`${response.status} ${response.statusText}`);
        return { success: true, uploadURL, filename };
      } catch (error) {
        logger.warn('PDF upload attempt failed', {
          operation,
          attempt: attempt + 1,
          correlationId,
          error: error.message,
        });
        if (attempt === 2) throw error;
        await delay(1000 * (attempt + 1));
      }
    }
  }

  async generateAndUploadProductPDF(productData, productSku, config) {
    const { logger, objectStorage, ws } = this.ctx;
    const correlationId = config?.correlationId || '∅';
    const operation = this.resolveOperation(config, 'process-attachments');
    const startedAt = now();
    try {
      const pdfBuffer = await this.generateProductPDF(
        productData,
        productSku,
        config
      );
      if (
        !pdfBuffer?.length ||
        !pdfBuffer.slice(0, 4).toString().includes('%PDF')
      )
        throw new Error('Invalid PDF buffer');
      const objectKey = `product-pdfs/${productSku}-${now()}.pdf`;
      const uploadResult = await objectStorage.uploadFile(
        objectKey,
        pdfBuffer,
        'application/pdf'
      );
      const durationMs = elapsedMs(startedAt);
      ws.emitBatchCompleted(
        {
          batchId: `pdf-upload-${productSku}`,
          entityType: 'media',
          successCount: 1,
          failureCount: 0,
          operation,
          meta: { durationMs },
        },
        { correlationId }
      );
      return {
        success: true,
        entityType: 'media',
        operation: 'generate-and-upload-pdf',
        objectPath: uploadResult.objectPath,
        fileName: `${productSku}_manual.pdf`,
        durationMs,
      };
    } catch (error) {
      logger.error('Failed to generate or upload PDF', {
        operation,
        correlationId,
        productSku,
        error: error.message,
      });
      ws.emitBatchCompleted(
        {
          batchId: `pdf-upload-${productSku}`,
          entityType: 'media',
          successCount: 0,
          failureCount: 1,
          errors: [{ message: error.message }],
          operation,
        },
        { correlationId }
      );
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
    const { logger, liferay, progress } = this.ctx;
    const { sessionId } = options;
    const correlationId = config?.correlationId || '∅';

    this.validateConfig(config, options);
    await this.validateOptions(config, options);

    const entityType = 'media-images';
    const operation = 'generate';
    const batchId = `images-individual-${Date.now()}`;
    const batchERC = createERC(ERC_PREFIX.MEDIA_BATCH);

    const productsWithImages = this.selectProductsForImages(products, options.imageRatio || 0);
    
    if (productsWithImages.length === 0) {
      logger.info('No products selected for image generation.', { sessionId });
      return;
    }

    progress.batchStarted({
      batchId,
      batchERC,
      entityType,
      totalItems: productsWithImages.length,
      operation,
      sessionId,
      correlationId
    });

    let completedCount = 0;
    for (const product of productsWithImages) {
      try {
        const images = this.generateProductImageSet(product.name.en_US);
        for (const image of images) {
          await liferay.addProductImage(config, product.id, image);
        }
        completedCount++;
      } catch (error) {
        logger.error(`Failed to create images for product ${product.id}`, { sessionId, error: error.message });
      }
      progress.batchProgress({
        batchId,
        batchERC,
        entityType,
        completedCount: completedCount,
        totalItems: productsWithImages.length,
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
      failureCount: productsWithImages.length - completedCount,
      operation,
      sessionId,
      correlationId,
    });
  }

  async createPdfs(config, products, options) {
    const { logger, liferay, progress } = this.ctx;
    const { sessionId } = options;
    const correlationId = config?.correlationId || '∅';

    this.validateConfig(config, options);
    await this.validateOptions(config, options);

    const entityType = 'media-pdfs';
    const operation = 'generate';
    const batchId = `pdfs-individual-${Date.now()}`;
    const batchERC = createERC(ERC_PREFIX.MEDIA_BATCH);

    const productsWithPdfs = this.selectProductsForPDFs(products, options.pdfRatio || 0);

    if (productsWithPdfs.length === 0) {
      logger.info('No products selected for PDF generation.', { sessionId });
      return;
    }

    progress.batchStarted({
      batchId,
      batchERC,
      entityType,
      totalItems: productsWithPdfs.length,
      operation,
      sessionId,
      correlationId
    });

    let completedCount = 0;
    for (const product of productsWithPdfs) {
        try {
            const pdfData = { title: `${product.name.en_US} Manual`, sections: [{ title: 'Overview', content: product.description.en_US }] };
            const sku = product.skus[0]?.sku || product.externalReferenceCode;
            const uploadResult = await this.generateAndUploadProductPDF(pdfData, sku, config);

            await liferay.addProductDocumentAttachment(config, product.id, {
                title: { en_US: uploadResult.fileName },
                src: uploadResult.objectPath,
                type: 'document'
            });

            completedCount++;
        } catch (error) {
            logger.error(`Failed to create PDF for product ${product.id}`, { sessionId, error: error.message });
        }
        progress.batchProgress({
            batchId,
            batchERC,
            entityType,
            completedCount,
            totalItems: productsWithPdfs.length,
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
      failureCount: productsWithPdfs.length - completedCount,
      operation,
      sessionId,
      correlationId,
    });
  }

  validateConfig(config, options) {
    if (!options.demoMode && (options.imageRatio ?? 0) > 0) {
        if (!config.imageGenerationKey) {
            // This is a soft warning for now as picsum is used as a fallback
            // In a real scenario, this might throw an error.
            console.warn('Image generation API key not configured. Using placeholder images.');
        }
    }
  }

  async validateOptions(config, options) {
    if (options.imageRatio && (typeof options.imageRatio !== 'number' || options.imageRatio < 0 || options.imageRatio > 100)) {
        throw new Error('imageRatio must be a number between 0 and 100');
    }
    if (options.pdfRatio && (typeof options.pdfRatio !== 'number' || options.pdfRatio < 0 || options.pdfRatio > 100)) {
        throw new Error('pdfRatio must be a number between 0 and 100');
    }
  }
}

module.exports = MediaGenerator;
