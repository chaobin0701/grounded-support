import { Controller, Get, NotFoundException, Param } from '@nestjs/common';
import { ProductCatalogService } from '../ai/tools/product-catalog/product-catalog.service';

@Controller('products')
export class ProductsController {
  constructor(private readonly catalog: ProductCatalogService) {}

  @Get()
  list() {
    return this.catalog.listPublicProducts();
  }

  @Get(':id')
  async detail(@Param('id') id: string) {
    const product = await this.catalog.getProductDetail(id);
    if (!product) throw new NotFoundException('PRODUCT_NOT_FOUND');
    return product;
  }
}
