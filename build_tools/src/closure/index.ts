import { BuilderContext, BuilderOutput, createBuilder } from '@angular-devkit/architect/src/index';
import { Observable, of } from 'rxjs';
import { catchError, mapTo, concatMap } from 'rxjs/operators';
import { exec } from 'child_process';
import {join, normalize} from 'path';
import {readFile, readFileSync, writeFile} from 'fs';
import { ClosureBuilderSchema } from './schema.interface';
import * as ts from 'typescript';

export function executeClosure(
  options: ClosureBuilderSchema,
  context: BuilderContext
): Observable<BuilderOutput> {
  return of(context).pipe(
    concatMap(results => ngc(options, context)),
    concatMap(results => compileMain(options, context)),
    concatMap(results => closure(options, context)),
    mapTo({ success: true }),
    catchError(error => {
      context.reportStatus('Error: ' + error);
      return [{ success: false }];
    }),
  );
}

export default createBuilder<Record<string, string> & ClosureBuilderSchema>(executeClosure);

export function ngc(
  options: ClosureBuilderSchema,
  context: BuilderContext
): Observable<{}> {
  return new Observable((observer) => {
    exec(`${normalize(context.workspaceRoot + '/node_modules/.bin/ngc')} -p ${options.tsConfig}`,
      {},
      (error, stdout, stderr) => {
        if (stderr) {
          observer.error(stderr);
        } else {
          observer.next(stdout);
        }
      });

  });
}

export function compileMain(
  options: ClosureBuilderSchema,
  context: BuilderContext
): Observable<{}> {

  return new Observable((observer) => {

    const inFile = normalize(context.workspaceRoot + '/src/main.ts');
    const outFile = normalize('out-tsc/src/main.js');
    const tsConfig = JSON.parse(readFileSync(join(context.workspaceRoot, options.tsConfig), 'utf8'));

    readFile(inFile, 'utf8', (err, contents) => {
      if (err) { observer.error(err); }
      contents = contents.replace(/platformBrowserDynamic/g, 'platformBrowser');
      contents = contents.replace(/platform-browser-dynamic/g, 'platform-browser');
      contents = contents.replace(/bootstrapModule/g, 'bootstrapModuleFactory');
      contents = contents.replace(/AppModule/g, 'AppModuleNgFactory');
      contents = contents.replace(/.module/g, '.module.ngfactory');

      const outputContent = ts.transpileModule(contents, {
        compilerOptions: tsConfig.compilerOptions,
        moduleName: 'app'
      });

      writeFile(outFile, outputContent.outputText, (err) => {
        if (err) { observer.error(err); }
        observer.next(outputContent.outputText);
      });

    });

  });
}

export function closure(
  options: ClosureBuilderSchema,
  context: BuilderContext
): Observable<{}> {

  return new Observable((observer) => {

    const target = context.target ? context.target : { project: 'app' };
    const jarPath = options.jarPath ? options.jarPath : join('node_modules', 'google-closure-compiler-java', 'compiler.jar');
    const confPath = options.closureConfig;
    const outFile = `./dist/${target.project}/main.js`;

    exec(`java -jar ${jarPath} --flagfile ${confPath} --js_output_file ${outFile}`,
      {},
      (error, stdout, stderr) => {
        if (stderr.includes('ERROR')) {
          observer.error(error);
        }
        observer.next(stdout);
      });
  });
}
