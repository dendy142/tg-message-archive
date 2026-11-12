import type { ColumnBuilderBaseConfig, ColumnDataType, ColumnBuilderExtraConfig } from 'drizzle-orm/column-builder';

declare module 'drizzle-orm/column-builder' {
  interface ColumnBuilder<
    T extends ColumnBuilderBaseConfig<ColumnDataType, string> = ColumnBuilderBaseConfig<ColumnDataType, string>,
    TRuntimeConfig extends object = object,
    TTypeConfig extends object = object,
    TExtraConfig extends ColumnBuilderExtraConfig = ColumnBuilderExtraConfig,
  > {
    deprecated(reason?: string): this;
  }
}
declare module 'drizzle-orm/sqlite-core/indexes' {
  interface IndexBuilder {
    deprecated(reason?: string): this;
  }
}
