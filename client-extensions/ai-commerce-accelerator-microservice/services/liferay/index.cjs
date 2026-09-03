const {
  LiferayService: BaseLiferayService,
} = require('@liferay/accelerator-sdk');

class LiferayService extends BaseLiferayService {
  constructor(ctx) {
    super(ctx);
    if (this.rest && typeof this.rest._chunkArray !== 'function') {
      this.rest._chunkArray = (arr, size) => {
        if (
          this.rest.batch &&
          typeof this.rest.batch._chunkArray === 'function'
        ) {
          return this.rest.batch._chunkArray(arr, size);
        }
        if (
          this.rest.batchDelete &&
          typeof this.rest.batchDelete._chunkArray === 'function'
        ) {
          return this.rest.batchDelete._chunkArray(arr, size);
        }
        const chunks = [];
        for (let i = 0; i < (arr || []).length; i += size) {
          chunks.push(arr.slice(i, i + size));
        }
        return chunks;
      };
    }
  }
}

module.exports = { LiferayService };
