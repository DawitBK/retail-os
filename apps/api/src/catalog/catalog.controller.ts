import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { paginationQuerySchema, ZodValidationPipe, type Pagination } from '@retail/kit';
import { CurrentUser, Roles, type Principal } from '../common/auth.js';
import {
  createBrandSchema,
  createCategorySchema,
  createProductSchema,
  createSubCategorySchema,
  idParamsSchema,
  listProductsQuerySchema,
  listSubCategoriesQuerySchema,
  updateBrandSchema,
  updateCategorySchema,
  updateProductSchema,
  updateSubCategorySchema,
  type CreateBrand,
  type CreateCategory,
  type CreateProduct,
  type CreateSubCategory,
  type ListProductsQuery,
  type ListSubCategoriesQuery,
  type UpdateBrand,
  type UpdateCategory,
  type UpdateProduct,
  type UpdateSubCategory,
} from './catalog.contract.js';
import { CatalogService } from './catalog.service.js';

const idParams = new ZodValidationPipe(idParamsSchema);
const page = new ZodValidationPipe(paginationQuerySchema);
/** Anyone signed in may read the catalogue (the till needs it); only managers and the owner change it. */
const MANAGERS = ['owner', 'manager'] as const;

@Controller('api/v1')
export class CatalogController {
  constructor(@Inject(CatalogService) private readonly catalog: CatalogService) {}

  // ---- categories ----

  @Get('categories')
  listCategories(@Query(page) p: Pagination) {
    return this.catalog.listCategories(p);
  }

  @Roles(...MANAGERS)
  @Post('categories')
  createCategory(
    @CurrentUser() actor: Principal,
    @Body(new ZodValidationPipe(createCategorySchema)) body: CreateCategory,
  ) {
    return this.catalog.createCategory(actor, body);
  }

  @Roles(...MANAGERS)
  @Patch('categories/:id')
  updateCategory(
    @CurrentUser() actor: Principal,
    @Param(idParams) p: { id: string },
    @Body(new ZodValidationPipe(updateCategorySchema)) body: UpdateCategory,
  ) {
    return this.catalog.updateCategory(actor, p.id, body);
  }

  @Roles(...MANAGERS)
  @Delete('categories/:id')
  @HttpCode(204)
  async deleteCategory(@CurrentUser() actor: Principal, @Param(idParams) p: { id: string }) {
    await this.catalog.deleteCategory(actor, p.id);
  }

  // ---- sub-categories ----

  @Get('sub-categories')
  listSubCategories(
    @Query(new ZodValidationPipe(listSubCategoriesQuerySchema)) q: ListSubCategoriesQuery,
  ) {
    return this.catalog.listSubCategories(q);
  }

  @Roles(...MANAGERS)
  @Post('sub-categories')
  createSubCategory(
    @CurrentUser() actor: Principal,
    @Body(new ZodValidationPipe(createSubCategorySchema)) body: CreateSubCategory,
  ) {
    return this.catalog.createSubCategory(actor, body);
  }

  @Roles(...MANAGERS)
  @Patch('sub-categories/:id')
  updateSubCategory(
    @CurrentUser() actor: Principal,
    @Param(idParams) p: { id: string },
    @Body(new ZodValidationPipe(updateSubCategorySchema)) body: UpdateSubCategory,
  ) {
    return this.catalog.updateSubCategory(actor, p.id, body);
  }

  @Roles(...MANAGERS)
  @Delete('sub-categories/:id')
  @HttpCode(204)
  async deleteSubCategory(@CurrentUser() actor: Principal, @Param(idParams) p: { id: string }) {
    await this.catalog.deleteSubCategory(actor, p.id);
  }

  // ---- brands ----

  @Get('brands')
  listBrands(@Query(page) p: Pagination) {
    return this.catalog.listBrands(p);
  }

  @Roles(...MANAGERS)
  @Post('brands')
  createBrand(
    @CurrentUser() actor: Principal,
    @Body(new ZodValidationPipe(createBrandSchema)) body: CreateBrand,
  ) {
    return this.catalog.createBrand(actor, body);
  }

  @Roles(...MANAGERS)
  @Patch('brands/:id')
  updateBrand(
    @CurrentUser() actor: Principal,
    @Param(idParams) p: { id: string },
    @Body(new ZodValidationPipe(updateBrandSchema)) body: UpdateBrand,
  ) {
    return this.catalog.updateBrand(actor, p.id, body);
  }

  @Roles(...MANAGERS)
  @Delete('brands/:id')
  @HttpCode(204)
  async deleteBrand(@CurrentUser() actor: Principal, @Param(idParams) p: { id: string }) {
    await this.catalog.deleteBrand(actor, p.id);
  }

  // ---- products ----

  @Get('products')
  listProducts(@Query(new ZodValidationPipe(listProductsQuerySchema)) q: ListProductsQuery) {
    return this.catalog.listProducts(q);
  }

  @Get('products/:id')
  getProduct(@Param(idParams) p: { id: string }) {
    return this.catalog.getProduct(p.id);
  }

  @Roles(...MANAGERS)
  @Post('products')
  createProduct(
    @CurrentUser() actor: Principal,
    @Body(new ZodValidationPipe(createProductSchema)) body: CreateProduct,
  ) {
    return this.catalog.createProduct(actor, body);
  }

  @Roles(...MANAGERS)
  @Patch('products/:id')
  updateProduct(
    @CurrentUser() actor: Principal,
    @Param(idParams) p: { id: string },
    @Body(new ZodValidationPipe(updateProductSchema)) body: UpdateProduct,
  ) {
    return this.catalog.updateProduct(actor, p.id, body);
  }

  @Roles(...MANAGERS)
  @Delete('products/:id')
  @HttpCode(204)
  async deleteProduct(@CurrentUser() actor: Principal, @Param(idParams) p: { id: string }) {
    await this.catalog.deleteProduct(actor, p.id);
  }

  @Roles('owner', 'manager', 'accountant')
  @Get('products/:id/movements')
  movements(@Param(idParams) p: { id: string }, @Query(page) q: Pagination) {
    return this.catalog.listMovements(p.id, q);
  }
}
