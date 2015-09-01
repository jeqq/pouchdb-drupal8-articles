(function() {
  'use strict';

  var app = angular.module('app', ['ngTagsInput']);

  app.config(['$compileProvider',
    function ($compileProvider) {
      $compileProvider.aHrefSanitizationWhitelist(/^\s*(https?|data):/);
    }]
  );

  app.factory('pouch',  function() {
    var db = new PouchDB('articles0003');
    var remote = '';
     db.sync(remote, {
       live: false
     });
    return db;
  });

  app.factory('util', ['$q', '$rootScope',
    function($q, $rootScope) {
      return {
        resolve: function(value) {
          $rootScope.$apply(function() {
            return $q.when(value);
          });
        },
        reject: function(error) {
          $rootScope.$apply(function() {
            return $q.reject(error);
          });
        }
      };
    }]);

  app.factory('Articles', ['$rootScope','pouch', 'util',
    function($rootScope, pouch, util) {
      var articles = {};
      var tags = {};
      var attachments = {};
      tags['all_names'] = [];

      pouch.changes({ live: true })
        .on('change', function handleUpdate(change) {
          if (!change.deleted) {
            pouch.get(change.id, {attachments:true}).then(function(doc) {
              if (doc['@type'] == 'node') {
                $rootScope.$apply(function() {
                  articles[doc._id] = doc;
                });

                // Get the list of tags.
                if (doc.field_tags) {
                  tags[doc._id] = [];
                  angular.forEach(doc.field_tags, function(value, key){
                    pouch.get(value.target_uuid).then(function (tag) {
                      if (!tag.deleted) {
                        var tagObj = {
                          'name': tag.name[0].value,
                          '_id': tag._id
                        };
                        $rootScope.$apply(function () {
                          tags[doc._id].push(tagObj);
                        });
                      }
                    })
                      .catch(function (reason) {
                        console.log(reason);
                      });
                  });
                }

                // Get the list of attachments.
                if (doc._attachments) {
                  attachments[doc._id] = [];
                  angular.forEach(doc._attachments, function(value, key){
                    $rootScope.$apply(function () {
                      // Get field name, delta, file uuid, scheme and filename from key.
                      var filemeta = key.split('/');
                      value['filename'] = filemeta[4];
                      attachments[doc._id].push(value);
                    });
                  });
                }
              }
              if (doc['@type'] == 'taxonomy_term') {
                var tagObj = {
                  'name': doc.name[0].value,
                  '_id': doc._id
                };
                $rootScope.$apply(function () {
                  tags['all_names'].push(tagObj);
                });
              }
            }, function(err) {
              console.log(err);
            });
          } else {
            $rootScope.$apply(function() {
              delete articles[change.id];
              delete tags[change.id];
            });
          }
        });

      return {
        articles: articles,
        tags: tags,
        attachments: attachments,
        add: function(article) {
          article['@type'] = article['@type'] ? article['@type'] : 'node';
          article.type = article.type ? article.type : [{'target_id': 'article'}];
          article.body = article.body ? article.body : [{'value' : ''}];
          article.status = (article.status && article.status[0].value) ? article.status : [{'value' : false}];
          var field_tags = [];
          if (article.field_tags) {
            field_tags = article.field_tags;
          } else if (articles[article._id].field_tags) {
            field_tags = articles[article._id].field_tags;
          }
          article.field_tags = field_tags;
          angular.forEach(field_tags, function(value, key){
            pouch.get(value.target_uuid).then(function(tag) {}, function(err) {
              // Save the tag if it doesn't exist.
              if (err.name === 'not_found') {
                var tag_obj = {
                  _id:  value.target_uuid,
                  '@type': 'taxonomy_term',
                  name: [{'value' : value.name}]
                };
                pouch.put(tag_obj).catch(function (reason) {
                  console.log(reason);
                });
              }
            });
          });
          console.log(article);
          return pouch.put(article).then(util.resolve).catch(function (reason) {
            console.log(reason);
          });
        },
        delete: function(_id) {
          return pouch.get(_id)
            .then(function(doc) {
              return pouch.remove(doc)
                .then(util.resolve, util.reject);
            })
            .catch(util.reject);
        },
        addTag: function (tag, article) {
          if (!articles[article._id]) {
            articles[article._id] = [];
          }
          if (!articles[article._id].field_tags) {
            articles[article._id].field_tags = [];
          }
          var _id = tag._id ? tag._id : PouchDB.utils.uuid();
          var tag_reference = {
            entity_type_id: 'taxonomy_term',
            target_uuid: _id,
            name: tag.name
          };
          articles[article._id].field_tags.push(tag_reference);
          console.log(articles[article._id]);
        }
      };
    }]);

  app.controller('ArticleCtrl', ['$scope', 'Articles',
    function($scope, Articles) {

      $scope.articles = Articles.articles;
      $scope.tags = Articles.tags;
      $scope.attachments = Articles.attachments;
      $scope.show = false;

      $scope.addArticle = function() {
        $scope.article = '';
        $scope.setId();
        $scope.show = true;
      };

      $scope.viewArticles = function() {
        $scope.show = false;
      };

      $scope.setId = function () {
        if (!$scope.article) {
          $scope.article = {};
          $scope.article._id = PouchDB.utils.uuid();
        }
      };

      $scope.submit = function(article) {
        Articles.add(article).then(function () {
          $scope.viewArticles();
          $scope.article = '';
        })
          .catch(function (reason) {
            console.log(reason);
          });
      };

      $scope.edit = function(article) {
        $scope.addArticle();
        $scope.article = article;
      };

      $scope.delete = function(article) {
        Articles.delete(article)
          .catch(function(reason) {
            console.log(reason);
          });
      };

      $scope.tagAdded = function(tag) {
        Articles.addTag(tag, $scope.article);
      };

      $scope.tagRemoved = function(tag, article) {
        var values = article.field_tags ? article.field_tags : [];
        angular.forEach(values, function(value, key) {
          if (value.target_uuid == tag._id) {
            delete $scope.article.field_tags[key];
          }
        });
      };

      $scope.loadTags = function(query) {
        return $scope.tags['all_names'];
      };
    }
  ]);

})();

