## [2.6.4](https://github.com/droidsolutions/amqp-ts/compare/v2.6.3...v2.6.4) (2022-04-04)


### Bug Fixes

* **deps:** bump minimist from 1.2.5 to 1.2.6 ([fdc830a](https://github.com/droidsolutions/amqp-ts/commit/fdc830a2b67028520bae0af3f512bb34f1bd2766))

## [2.6.3](https://github.com/droidsolutions/amqp-ts/compare/v2.6.2...v2.6.3) (2022-02-28)


### Bug Fixes

* **deps:** bump node-fetch from 2.6.2 to 2.6.7 ([0256384](https://github.com/droidsolutions/amqp-ts/commit/025638421b856efce76bc462b4728b5e05aeef88))

## [2.6.2](https://github.com/droidsolutions/amqp-ts/compare/v2.6.1...v2.6.2) (2022-02-28)


### Bug Fixes

* **deps:** bump url-parse from 1.5.7 to 1.5.10 ([e232a35](https://github.com/droidsolutions/amqp-ts/commit/e232a35561ea2084e992a4b128352e9a2e309818))

## [2.6.1](https://github.com/droidsolutions/amqp-ts/compare/v2.6.0...v2.6.1) (2022-02-21)


### Bug Fixes

* **deps:** bump url-parse from 1.5.3 to 1.5.7 ([d05e581](https://github.com/droidsolutions/amqp-ts/commit/d05e5813e4e0aeb80ef043f60c949e9f3793987f))

# [2.6.0](https://github.com/droidsolutions/amqp-ts/compare/v2.5.1...v2.6.0) (2021-09-24)


### Features

* add basic metrics to the connection instance ([88cba45](https://github.com/droidsolutions/amqp-ts/commit/88cba45ea8756ac8a16c6f8a51e0cf7962d0ed1a))

## [2.5.1](https://github.com/droidsolutions/amqp-ts/compare/v2.5.0...v2.5.1) (2021-07-16)


### Bug Fixes

* **npm:** include js and d.ts files in NPM package ([5174079](https://github.com/droidsolutions/amqp-ts/commit/51740791a5204b32bad989fef0cea6d93afe5a95))

## [2.5.1-develop.1](https://github.com/droidsolutions/amqp-ts/compare/v2.5.0...v2.5.1-develop.1) (2021-07-16)


### Bug Fixes

* **npm:** include js and d.ts files in NPM package ([5174079](https://github.com/droidsolutions/amqp-ts/commit/51740791a5204b32bad989fef0cea6d93afe5a95))

# [2.5.0](https://github.com/droidsolutions/amqp-ts/compare/v2.4.2...v2.5.0) (2021-07-15)


### Features

* update amqplib to 0.8.0 ([9ef47cf](https://github.com/droidsolutions/amqp-ts/commit/9ef47cf36782b99ca069dfee73eb64add2a154c7))

## [2.4.2](https://github.com/droidsolutions/amqp-ts/compare/v2.4.1...v2.4.2) (2021-05-11)


### Bug Fixes

* **deps:** run npm audit fix ([5fef092](https://github.com/droidsolutions/amqp-ts/commit/5fef0925f15d35719f609b36cd24bbcabb290e04))

## [2.4.1](https://github.com/droidsolutions/amqp-ts/compare/v2.4.0...v2.4.1) (2021-03-22)


### Bug Fixes

* update typescript type for options in activateConsumer ([acfd9db](https://github.com/droidsolutions/amqp-ts/commit/acfd9dba949ca0add030ba800fa40c010dfab484))

# [2.4.0](https://github.com/droidsolutions/amqp-ts/compare/v2.3.0...v2.4.0) (2021-03-22)


### Features

* add message properties to consumer options ([6d73eb5](https://github.com/droidsolutions/amqp-ts/commit/6d73eb518144602abbfb8db20bf030076895ce9c))

# [2.3.0](https://github.com/droidsolutions/amqp-ts/compare/v2.2.1...v2.3.0) (2021-03-12)


### Features

* set Timestamp of message when not given by user ([b576a56](https://github.com/droidsolutions/amqp-ts/commit/b576a56dc273e4d6803a0bff7473bda9c4cbe3db))

## [2.2.1](https://github.com/droidsolutions/amqp-ts/compare/v2.2.0...v2.2.1) (2021-03-10)


### Bug Fixes

* don't send auto reply when consumer handler does not return a value ([aa0a6e1](https://github.com/droidsolutions/amqp-ts/commit/aa0a6e1b7d2ba701f43fe6c29415f62e94aebad4))

# [2.2.0](https://github.com/droidsolutions/amqp-ts/compare/v2.1.0...v2.2.0) (2021-03-09)


### Features

* add declareQueueAsync and declareExchangeAsync ([0e52d9a](https://github.com/droidsolutions/amqp-ts/commit/0e52d9a071aafae540abc00a78b46bf51bcc9ce8))

# [2.1.0](https://github.com/droidsolutions/amqp-ts/compare/v2.0.0...v2.1.0) (2021-03-03)


### Bug Fixes

* check process.argv length before determining app name ([f7d0a18](https://github.com/droidsolutions/amqp-ts/commit/f7d0a18193e631bd3f4dfc4eb1ada889a36d8bd2)), closes [abreits/amqp-ts/#62](https://github.com/abreits/amqp-ts//issues/62)


### Features

* add ExchangeType to prevent wrong exchange type ([e80a01e](https://github.com/droidsolutions/amqp-ts/commit/e80a01e98e7b773503f24009beda3ecb1291e3ce))

# [2.0.0](https://github.com/droidsolutions/amqp-ts/compare/v1.3.2...v2.0.0) (2021-02-01)


### Code Refactoring

* replac eunused options interface with amqplib interface ([679359c](https://github.com/droidsolutions/amqp-ts/commit/679359c2579d24b00ce3a74773353efe63632f09))


### BREAKING CHANGES

* removes StartConsumerOptions export.
* Queue.activateConsumer and Exchange.activateConsumer now takes the
AmqpLib.Options.Consume interface
instead of the StartConsumerOptions. The interfaces look the same so no special actions should be
needed.

Also adds JSDOC comments on public queue methods and properties.

## [1.3.2](https://github.com/droidsolutions/amqp-ts/compare/v1.3.1...v1.3.2) (2020-11-20)


### Bug Fixes

* export ReconnectStrategy ([c9baa02](https://github.com/droidsolutions/amqp-ts/commit/c9baa0213c3b3068fbcb925f932c682bf46bb41a))

## [1.3.1](https://github.com/droidsolutions/amqp-ts/compare/v1.3.0...v1.3.1) (2020-10-15)


### Bug Fixes

* suppress "content is not a buffer" ([284b492](https://github.com/droidsolutions/amqp-ts/commit/284b492ad4b3cd3491d809fcc01813ef50f224d2))

# [1.3.0](https://github.com/droidsolutions/amqp-ts/compare/v1.2.1...v1.3.0) (2020-09-28)


### Features

* emit jsdoc in transpiled js ([27c5619](https://github.com/droidsolutions/amqp-ts/commit/27c561917999edddc8cbab80e0a9216d11327d85))

## [1.2.1](https://github.com/droidsolutions/amqp-ts/compare/v1.2.0...v1.2.1) (2020-09-28)


### Bug Fixes

* implement AmqpProperties for librrary consumers and add documentation ([e28d535](https://github.com/droidsolutions/amqp-ts/commit/e28d53538a722a89b6c0e7d8884506d686ffe6c3))

# [1.2.0](https://github.com/droidsolutions/amqp-ts/compare/v1.1.1...v1.2.0) (2020-09-28)


### Features

* add generic getJsonContent method to Message ([931d40e](https://github.com/droidsolutions/amqp-ts/commit/931d40eac304e67d9c0bd649495cec301e393563))

## [1.1.1](https://github.com/droidsolutions/amqp-ts/compare/v1.1.0...v1.1.1) (2020-09-28)


### Bug Fixes

* re-export Amqp property type ([2b8b887](https://github.com/droidsolutions/amqp-ts/commit/2b8b887e45b69dcc6da65ef15e944b919fe26022))

# [1.1.0](https://github.com/droidsolutions/amqp-ts/compare/v1.0.3...v1.1.0) (2020-09-28)


### Features

* set type of Message properties ([b7c965c](https://github.com/droidsolutions/amqp-ts/commit/b7c965c64e24fe48ff34010f1089544a8d9e07dd))
* **deps:** update amqplib to 0.6.0 ([8106b1c](https://github.com/droidsolutions/amqp-ts/commit/8106b1c0a2c8bd0dd2afaa3a34156d0c5dc224e7))

## [1.0.3](https://github.com/droidsolutions/amqp-ts/compare/v1.0.2...v1.0.3) (2020-05-25)


### Bug Fixes

* update amqlib to 0.5.6 ([e254676](https://github.com/droidsolutions/amqp-ts/commit/e254676df29b9c8ce7e369bf58ba8c356f99d4bc))

## [1.0.2](https://github.com/droidsolutions/amqp-ts/compare/v1.0.1...v1.0.2) (2020-04-15)


### Bug Fixes

* make message content public again ([8f19be1](https://github.com/droidsolutions/amqp-ts/commit/8f19be18ea0e591308ddfd72dcc5cc955133fa03))
* make properties of Message public again ([7b3b6ef](https://github.com/droidsolutions/amqp-ts/commit/7b3b6efb24944eefa55c447c2573985bbfc4c1e2))
* make type constructor arg for Exchange optional again ([6cbeae5](https://github.com/droidsolutions/amqp-ts/commit/6cbeae5296b4befa907352ff8e8dde77fb254d40))

## [1.0.1](https://github.com/droidsolutions/amqp-ts/compare/v1.0.0...v1.0.1) (2020-04-14)


### Bug Fixes

* add publishConfig to mark to package public ([a97ba95](https://github.com/droidsolutions/amqp-ts/commit/a97ba95b18dc005af88af4e3c60ccf599bb4e867))

# 1.0.0 (2020-04-14)


### Features

* remove winston and add logger factory ([75c5cd1](https://github.com/droidsolutions/amqp-ts/commit/75c5cd131d0c5458e107c62a95d3c344e91bcf6e))
* update amqplib to 0.5.5 ([ffc3d42](https://github.com/droidsolutions/amqp-ts/commit/ffc3d42583a965c4e2e6d313692054c965c3cc95))
