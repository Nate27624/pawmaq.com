declare module "i18n-iso-countries" {
  interface GetNamesOptions {
    select?: "official" | "alias";
  }

  interface IsoCountriesApi {
    registerLocale(localeData: unknown): void;
    getNames(lang: string, options?: GetNamesOptions): Record<string, string>;
    getAlpha2Code(countryName: string, lang: string): string | undefined;
  }

  const isoCountries: IsoCountriesApi;
  export default isoCountries;
}

declare module "i18n-iso-countries/langs/en.json" {
  const locale: unknown;
  export default locale;
}
